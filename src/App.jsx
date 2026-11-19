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
  const [error, setError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const fileInput = useRef(null);
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
      video.current.play().catch(() => setError('摄像头预览失败。'));
    }
  }, [cameraOpen]);

  const existingCoverage = useMemo(() => unionMasks(game.parts.map(part => part.mask)), [game.parts]);
  const pendingCoverage = useMemo(() => pending && images ? partMask(pending, images[pending.type]) : null, [pending, images]);
  const coverage = useMemo(() => pendingCoverage ? unionMasks([existingCoverage, pendingCoverage]) : existingCoverage, [existingCoverage, pendingCoverage]);
  const score = useMemo(() => scoreLines(game.lines, coverage), [game.lines, coverage]);
  const reward = useMemo(() => pendingCoverage ? replacementReward(existingCoverage, pendingCoverage, pending.rate) : { newArea: 0, money: 0 }, [existingCoverage, pendingCoverage, pending]);
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
      setError('摄像头不可用。');
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
      const reason = e.name === 'NotAllowedError' ? '摄像头权限被拒绝。'
        : e.name === 'NotFoundError' ? '未找到摄像头。'
          : '无法打开摄像头。';
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
        cleanup();
        if (data.error) reject(new Error(data.error)); else resolve(data);
      };
      const onError = () => {
        cleanup();
        target.terminate();
        worker.current = null;
        reject(new Error('本地推理失败。'));
      };
      const timeout = setTimeout(() => {
        cleanup();
        target.terminate();
        worker.current = null;
        reject(new Error('识别超时。'));
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
    } catch (e) {
      if (id === generation.current) setError(e.message);
    } finally { if (id === generation.current) setBusy(false); }
  }

  function takePhoto() {
    const source = video.current;
    if (!source?.videoWidth || source.readyState < 2) { setError('摄像头未就绪。'); return; }
    const scale = Math.min(1, 1024 / Math.max(source.videoWidth, source.videoHeight));
    const canvas = makeCanvas(Math.round(source.videoWidth * scale), Math.round(source.videoHeight * scale));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    ingest(() => canvas);
  }

  function choosePart(offer) {
    setPending({ ...offer, x: SIZE / 2, y: SIZE / 2 });
  }

  function placePart() {
    if (!pending || !pendingCoverage || !reward.money) return;
    setGame({ ...game, parts: [...game.parts, { ...pending, mask: pendingCoverage }], offers: game.offers.filter(offer => offer.id !== pending.id), money: game.money + reward.money });
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
  }

  return <main>
    <h1>手相改造</h1>
    <div className="toolbar">
      <input ref={fileInput} aria-label="上传手掌照片" type="file" hidden accept="image/jpeg,image/png,image/webp,image/avif,image/heic" disabled={busy || cameraStarting} onChange={event => {
        const file = event.target.files[0];
        event.target.value = '';
        if (file) ingest(() => fileToCanvas(file));
      }} />
      <button onClick={() => fileInput.current?.click()} disabled={busy || cameraStarting}>上传手掌照片</button>
      {!cameraOpen && <button onClick={startCamera} disabled={busy || cameraStarting}>{cameraStarting ? '等待摄像头权限…' : '打开摄像头'}</button>}
      {(cameraOpen || cameraStarting) && <button onClick={closeCamera}>关闭摄像头</button>}
    </div>
    {cameraOpen && <section className="camera-panel" aria-label="摄像头预览">
      <video ref={video} muted playsInline autoPlay aria-label="摄像头画面" />
      <button onClick={takePhoto}>拍照并识别</button>
    </section>}
    {busy && <p role="status" aria-live="polite" className="status">识别中…</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="game-layout">
      <section className="photo-panel" aria-label="手掌改造画布">
        <div className={`stage${pending ? ' placing' : ''}`} data-testid="stage" tabIndex={pending ? 0 : -1}
          aria-label="手掌画布"
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
        </div>
      </section>
      <div className="controls">
        <section aria-label="评分">
          <div className="numbers"><p>总分 <strong data-testid="score">{ready ? score.total : '—'}</strong></p><p>金钱 <strong data-testid="money">¥{game.money}</strong></p></div>
          <table>
            <thead><tr><th>掌纹</th><th>总线长</th><th>有效可见长度</th></tr></thead>
            <tbody>{LINE_NAMES.map((name, index) => <tr key={name}><th scope="row">{index + 1} {name}</th><td>{ready ? `${pathLength(game.lines[index].points).toFixed(1)} px` : '—'}</td><td data-testid={`length-${index}`}>{ready ? `${score.lengths[index].toFixed(1)} px` : '—'}</td></tr>)}</tbody>
          </table>
        </section>
        <section aria-label="机械改造">
          <h2>机械改造</h2>
          <div className="offers">{game.offers.map(offer => <button key={offer.id} className={pending?.id === offer.id ? 'selected' : ''} aria-pressed={pending?.id === offer.id} disabled={!ready || !images} onClick={() => choosePart(offer)}>
            <img src={assetUrl(`parts/${offer.type}.svg`)} alt="" /><span>{offer.name}</span><small>{offer.width}×{offer.height} px<br />¥{offer.rate}/100 px²</small>
          </button>)}</div>
          {pending && <div className="placement">
            <div className="toolbar"><button onClick={placePart} disabled={reward.money === 0}>安装并获得 ¥{reward.money}</button><button onClick={() => setPending(null)}>取消放置</button><small>{reward.newArea.toLocaleString()} px²</small></div>
          </div>}
        </section>
        <section aria-label="购买注射">
          <h2>注射延长</h2>
          <div className="toolbar"><label>选择掌纹 <select aria-label="选择掌纹" value={selectedLine} disabled={!ready} onChange={event => setSelectedLine(Number(event.target.value))}>{LINE_NAMES.map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>
            <button onClick={inject} disabled={!ready || game.money < INJECTION_COST}>购买注射 · ¥{INJECTION_COST}</button></div>
        </section>
      </div>
    </div>
  </main>;
}
