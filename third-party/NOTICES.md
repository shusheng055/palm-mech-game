# Third-party notices

## Palm Line Reader

- Source: https://github.com/samuelwbarber/palm-line-reader
- Commit: bc48939f4deee6d8ff842bfde499396dab9c4830
- Copyright (c) 2026 Sam Barber.
- License: MIT, full text in `palm-line-reader-LICENSE.txt`.
- Bundled unchanged: `student_fp16.onnx`, `model_meta.json`, `pipeline/hand_landmarker.task`, and two upstream test images. The Y4M camera test fixture is a conversion of `docs/example1_input.png`.
- The application follows the upstream RGB / ImageNet preprocessing contract and hand crop orientation. Application UI, geometry/game rules, path extraction and SVG mechanical assets were implemented for this prototype.

## MediaPipe Tasks Vision / Hand Landmarker

- Source: https://github.com/google-ai-edge/mediapipe
- Package: `@mediapipe/tasks-vision` 0.10.22-rc.20250304.
- Copyright Google LLC and contributors.
- Apache License 2.0; see `mediapipe-LICENSE.txt`.
- Documentation: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker
- Runtime JS and WASM are copied unchanged from the installed package to `public/runtime/vision/`.

## MediaPipe MagicTouch Interactive Segmenter

- Model authors: Valentin Bazarevsky and Ben Hahn, Google (March 2023).
- License: Apache License 2.0; see `mediapipe-LICENSE.txt`.
- Model card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MagicTouch.pdf
- Source: https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite
- Bundled unchanged as `public/models/magic_touch.tflite` (6,227,884 bytes, SHA-256 `e24338a717c1b7ad8d159666677ef400babb7f33b8ad60c4d96db4ecf694cd25`).
- The model produces an object/background pixel mask using an automatic point prompt from the detected hand landmarks.

## ONNX Runtime Web

- Source: https://github.com/microsoft/onnxruntime
- Package: `onnxruntime-web` 1.20.1.
- Copyright (c) Microsoft Corporation. All rights reserved.
- MIT license; see `onnxruntime-LICENSE.txt`.
- WASM runtime files are copied unchanged into `public/runtime/ort/`.

## React / React DOM

- Source: https://github.com/facebook/react
- Packages: React and React DOM 19.2.0.
- Copyright Meta Platforms, Inc. and affiliates.
- MIT license; see `react-LICENSE.txt`.

## Development dependencies

- Vite 6.4.6: https://github.com/vitejs/vite — MIT.
- Playwright 1.56.1: https://github.com/microsoft/playwright — Apache-2.0.
- Dependency versions and transitive dependencies are pinned in `package-lock.json`. Installed packages retain their own license notices.
