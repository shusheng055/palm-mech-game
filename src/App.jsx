import React, { useEffect, useMemo, useRef, useState } from 'react';
import { INJECTION_COST, LINE_NAMES, SIZE, pathLength, purchaseInjection, replacementReward, scoreLines, unionMasks } from './game.js';
import { assetUrl, fileToCanvas, makeCanvas, normalizePalm } from './vision.js';
import { drawPart, loadPartImages, partMask, randomOffers } from './parts.js';

const emptyGame = () => ({ photo: null, lines: [], parts: [], offers: [], money: 0 });

export default function App() {
  const [game, setGame] = useState(emptyGame);
  const [images, setImages] = useState(null);
  const [pending, setPending] = useState(null);
  const [selectedLine, setSelectedLine] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('上传手掌照片，或打开摄像头拍照。');
  const [error, setError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const photoCanvas = useRef(null), lineCanvas = useRef(null), partCanvas = useRef(null);
  const video = useRef(null), stream = useRef(null), worker = useRef(null);
  const cameraGeneration = useRef(0), generation = useRef(0), dragging = useRef(false);

  useEffect(() => {
    let alive = true;
    loadPartImages().then(value => { if (alive) setImages(value); }).catch(e => { if (alive) setError(e.message); });
    return () => {
      alive = false;
      cameraGeneration.current++;
      generation.current++;
      stream.current?.getTracks().forEach(track => track.stop());
      worker.current?.terminate();
    };
  }, []);

  useEffect(() => {
    if (cameraOpen && video.current && stream.current) {
      video.current.srcObject = stream.current;
      video.current.play().catch(() => setError('摄像头预览无法播放，请关闭后重试。'));
    }
  }, [cameraOpen]);

  const existingCoverage = useMemo(() => unionMasks(game.parts.map(part => part.mask)), [game.parts]);
  const pendingCoverage = useMemo(() => pending && images ? partMask(pending, images[pending.type]) : null, [pending, images]);
  const coverage = useMemo(() => pendingCoverage ? unionMasks([existingCoverage, pendingCoverage]) : existingCoverage, [existingCoverage, pendingCoverage]);
  const score = useMemo(() => scoreLines(game.lines, coverage), [game.lines, coverage]);
  const reward = useMemo(() => pendingCoverage ? replacementReward(existingCoverage, pendingCoverage, pending.rate) : { newArea: 0, money: 0 }, [existingCoverage, pendingCoverage, pending]);
  const coveredArea = coverage.reduce((sum, value) => sum + value, 0);
  const ready = game.lines.length === 3 && !busy;

  useEffect(() => {
    const ctx = photoCanvas.current.getContext('2d');
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (game.photo) ctx.drawImage(game.photo, 0, 0, SIZE, SIZE);
  }, [game.photo]);

  useEffect(() => {
    const ctx = lineCanvas.current.getContext('2d');
    ctx.clearRect(0, 0, SIZE, SIZE);
    game.lines.forEach((line, index) => {
      const draw = () => {
        ctx.beginPath();
        line.points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.stroke();
      };
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 5;
      draw();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.setLineDash([[], [7, 4], [2, 4]][index]);
      draw();
      ctx.setLineDash([]);
      const [x, y] = line.points[0];
      ctx.font = '18px sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.strokeText(String(index + 1), x + 5, y - 5);
      ctx.fillStyle = '#000';
      ctx.fillText(String(index + 1), x + 5, y - 5);
    });
  }, [game.lines]);

  useEffect(() => {
    const ctx = partCanvas.current.getContext('2d');
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (!images) return;
    game.parts.forEach(part => drawPart(ctx, part, images[part.type]));
    if (pending) {
      drawPart(ctx, pending, images[pending.type]);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(pending.x - pending.width / 2 - 4, pending.y - pending.height / 2 - 4, pending.width + 8, pending.height + 8);
      ctx.setLineDash([]);
    }
  }, [images, game.parts, pending]);

  function closeCamera() {
    cameraGeneration.current++;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    setCameraOpen(false);
    setCameraStarting(false);
  }

  async function startCamera() {
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('此页面无法调用摄像头。请通过 localhost 或 HTTPS 打开，或上传照片。');
      return;
    }
    const request = ++cameraGeneration.current;
    setCameraStarting(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1024 }, height: { ideal: 1024 } }, audio: false });
      if (request !== cameraGeneration.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      setCameraOpen(true);
    } catch (e) {
      if (request !== cameraGeneration.current) return;
      const reason = e.name === 'NotAllowedError' ? '摄像头权限被拒绝。请允许浏览器使用摄像头，或上传照片。'
        : e.name === 'NotFoundError' ? '没有找到摄像头，请连接摄像头或上传照片。'
          : '无法打开摄像头，可能正被其他应用占用。请关闭其他应用后重试，或上传照片。';
      setError(reason);
    } finally { if (request === cameraGeneration.current) setCameraStarting(false); }
  }

  function infer(canvas, id) {
    worker.current ||= new Worker(new URL('./inference.worker.js', import.meta.url), { type: 'module' });
    const target = worker.current;
    const rgba = canvas.getContext('2d').getImageData(0, 0, SIZE, SIZE).data.buffer;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        target.removeEventListener('message', onMessage);
        target.removeEventListener('error', onError);
      };
      const onMessage = ({ data }) => {
        if (data.id !== id) return;
        if (data.progress) { if (generation.current === id) setStatus(data.progress); return; }
        cleanup();
        if (data.error) reject(new Error(data.error)); else resolve(data);
      };
      const onError = () => {
        cleanup();
        target.terminate();
        worker.current = null;
        reject(new Error('本地推理进程无法运行。请使用较新的 Chrome / Edge，并检查本地运行文件是否完整。'));
      };
      const timeout = setTimeout(() => {
        cleanup();
        target.terminate();
        worker.current = null;
        reject(new Error('本地识别超过 180 秒，已停止。请关闭其他占用资源的页面后重试。'));
      }, 180000);
      target.addEventListener('message', onMessage);
      target.addEventListener('error', onError);
      target.postMessage({ id, rgba, baseUrl: assetUrl('') }, [rgba]);
    });
  }

  async function ingest(getSource) {
    const id = ++generation.current;
    closeCamera();
    setGame(emptyGame());
    setPending(null);
    setSelectedLine(0);
    setError('');
    setBusy(true);
    setStatus('读取照片并定位手掌…');
    try {
      const source = await getSource();
      if (id !== generation.current) return;
      setGame({ ...emptyGame(), photo: source });
      const photo = await normalizePalm(source);
      if (id !== generation.current) return;
      setGame({ ...emptyGame(), photo });
      const result = await infer(photo, id);
      if (id !== generation.current) return;
      setGame({ ...emptyGame(), photo, lines: result.lines, offers: randomOffers() });
      setStatus(`三条掌纹识别完成（本地推理 ${result.milliseconds} ms）。可以开始改造。`);
    } catch (e) {
      if (id === generation.current) { setError(e.message); setStatus('识别失败。请换一张照片或重拍。'); }
    } finally { if (id === generation.current) setBusy(false); }
  }

  function takePhoto() {
    const source = video.current;
    if (!source?.videoWidth || source.readyState < 2) { setError('摄像头画面尚未就绪，请稍后再拍。'); return; }
    const scale = Math.min(1, 1024 / Math.max(source.videoWidth, source.videoHeight));
    const canvas = makeCanvas(Math.round(source.videoWidth * scale), Math.round(source.videoHeight * scale));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    ingest(() => canvas);
  }

  function choosePart(offer) {
    setPending({ ...offer, x: SIZE / 2, y: SIZE / 2 });
    setStatus('放置预览：点击或拖动画布调整位置，然后安装。预览也计入当前可见长度。');
  }

  function placePart() {
    if (!pending || !pendingCoverage || !reward.money) return;
    setGame({ ...game, parts: [...game.parts, { ...pending, mask: pendingCoverage }], offers: game.offers.filter(offer => offer.id !== pending.id), money: game.money + reward.money });
    setStatus(`已安装${pending.name}，获得 ¥${reward.money}。机械部件固定，遮盖部分不计分。`);
    setPending(null);
  }

  function movePending(event) {
    if (!pending) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(SIZE, (event.clientX - bounds.left) / bounds.width * SIZE));
    const y = Math.max(0, Math.min(SIZE, (event.clientY - bounds.top) / bounds.height * SIZE));
    setPending(part => part ? { ...part, x, y } : null);
  }

  function inject() {
    const result = purchaseInjection(game.lines, selectedLine, game.money);
    if (!result.ok) { setError(result.message); return; }
    setError('');
    setGame({ ...game, lines: result.lines, money: result.money });
    setStatus(`${LINE_NAMES[selectedLine]}已注射，游戏线长增加 ${result.added.toFixed(1)} px，花费 ¥${INJECTION_COST}。被机械遮住的延长部分不加分。`);
  }

  return <main>
    <h1>手相改造 <span>第一版原型</span></h1>
    <p>上传或拍摄一只张开的手掌，识别三条掌纹后开始改造。照片只在浏览器内处理。</p>
    <div className="toolbar">
      <label className="upload">上传手掌照片 <input aria-label="上传手掌照片" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic" disabled={busy || cameraStarting} onChange={event => {
        const file = event.target.files[0];
        event.target.value = '';
        if (file) ingest(() => fileToCanvas(file));
      }} /></label>
      {!cameraOpen && <button onClick={startCamera} disabled={busy || cameraStarting}>{cameraStarting ? '等待摄像头权限…' : '打开摄像头'}</button>}
      {(cameraOpen || cameraStarting) && <button onClick={closeCamera}>关闭摄像头</button>}
    </div>
    <p className="hint">掌心朝向镜头、光线充足、五指张开。新照片或重拍会清空机械、注射和金钱。</p>
    {cameraOpen && <section className="camera-panel" aria-label="摄像头预览">
      <video ref={video} muted playsInline autoPlay aria-label="摄像头画面" />
      <button onClick={takePhoto}>拍照并识别</button>
    </section>}
    <p role="status" aria-live="polite" className="status">{status}</p>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="game-layout">
      <section className="photo-panel" aria-label="手掌改造画布">
        <div className={`stage${pending ? ' placing' : ''}`} data-testid="stage" tabIndex={pending ? 0 : -1}
          aria-label="手掌画布。放置机械时可点击、拖动，或用方向键移动，回车安装。"
          onPointerDown={event => { if (pending) { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); movePending(event); } }}
          onPointerMove={event => { if (dragging.current) movePending(event); }}
          onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}
          onKeyDown={event => {
            if (!pending) return;
            if (event.key === 'Enter') { event.preventDefault(); placePart(); return; }
            const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
            if (delta) { event.preventDefault(); const step = event.shiftKey ? 20 : 4; setPending(part => ({ ...part, x: Math.max(0, Math.min(SIZE, part.x + delta[0] * step)), y: Math.max(0, Math.min(SIZE, part.y + delta[1] * step)) })); }
          }}>
          <canvas ref={photoCanvas} width={SIZE} height={SIZE} className="photo-layer" aria-label="照片底层" />
          <canvas ref={lineCanvas} width={SIZE} height={SIZE} className="line-layer" aria-label="掌纹和注射中层" />
          <canvas ref={partCanvas} width={SIZE} height={SIZE} className="part-layer" aria-label="机械顶层" />
          {!game.photo && <p className="placeholder">等待手掌照片</p>}
        </div>
        <p className="hint">画布 512×512 px · 1 感情线（实线）· 2 智慧线（虚线）· 3 生命线（点线）</p>
      </section>
      <div className="controls">
        <section aria-label="评分">
          <div className="numbers"><p>总分 <strong data-testid="score">{ready ? score.total : '—'}</strong>{pending && '（放置预览）'}</p><p>金钱 <strong data-testid="money">¥{game.money}</strong></p></div>
          <table>
            <thead><tr><th>掌纹</th><th>总线长</th><th>有效可见长度</th></tr></thead>
            <tbody>{LINE_NAMES.map((name, index) => <tr key={name}><th scope="row">{index + 1} {name}</th><td>{ready ? `${pathLength(game.lines[index].points).toFixed(1)} px` : '—'}</td><td data-testid={`length-${index}`}>{ready ? `${score.lengths[index].toFixed(1)} px` : '—'}</td></tr>)}</tbody>
          </table>
          <p className="hint">总分 = 三条有效可见线长之和 × 10，四舍五入。仅为游戏虚构规则，不代表健康或命运。</p>
        </section>
        <section aria-label="机械改造">
          <h2>机械改造</h2>
          <p>随机提供 3 件不同部件。选择后放置，安装即可获得金钱。</p>
          <div className="offers">{game.offers.map(offer => <button key={offer.id} className={pending?.id === offer.id ? 'selected' : ''} aria-pressed={pending?.id === offer.id} disabled={!ready || !images} onClick={() => choosePart(offer)}>
            <img src={assetUrl(`parts/${offer.type}.svg`)} alt="" /><span>{offer.name}</span><small>{offer.width}×{offer.height} px<br />每 100 px² 获 ¥{offer.rate}</small>
          </button>)}</div>
          {!game.offers.length && <p className="hint">{ready ? '本次照片的机械部件已用完。' : '三条掌纹全部识别成功后显示部件。'}</p>}
          {pending && <div className="placement">
            <p>新增覆盖 {reward.newArea.toLocaleString()} px² · 安装可获 <strong>¥{reward.money}</strong></p>
            <div className="toolbar"><button onClick={placePart} disabled={reward.money === 0}>安装并获得 ¥{reward.money}</button><button onClick={() => { setPending(null); setStatus('已取消放置，未改变金钱。'); }}>取消放置</button></div>
            <p className="hint">点击或拖动画布放置；方向键也可移动。安装后固定。重叠部分不重复发钱。</p>
          </div>}
          <p className="hint">当前机械覆盖画布 {(coveredArea / (SIZE * SIZE) * 100).toFixed(1)}%。透明孔洞保留可见掌纹。</p>
        </section>
        <section aria-label="购买注射">
          <h2>注射延长</h2>
          <div className="toolbar"><label>选择掌纹 <select aria-label="选择掌纹" value={selectedLine} disabled={!ready} onChange={event => setSelectedLine(Number(event.target.value))}>{LINE_NAMES.map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>
            <button onClick={inject} disabled={!ready || game.money < INJECTION_COST}>购买注射 · ¥{INJECTION_COST}</button></div>
          <p className="hint">每次沿一端延长最多 24 px，到画布边缘停止。不播放动画；机械会遮住延长线。</p>
        </section>
      </div>
    </div>
  </main>;
}
