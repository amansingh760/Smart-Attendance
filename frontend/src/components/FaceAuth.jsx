/**
 * FaceAuth.jsx
 *
 * Face authentication component using face-api.js (TensorFlow.js-based).
 * Models are loaded from jsDelivr CDN. No backend ML needed — all inference
 * runs in the browser. The face descriptor (128-dim float vector) is sent
 * to the backend for storage/comparison.
 *
 * Props:
 *   mode:        'enroll' | 'verify'
 *   onSuccess:   (descriptor?) => void   — called on success
 *   onCancel:    () => void
 *   userName:    string                  — shown in UI
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model';

let faceApiLoaded = false;
let faceApiLoading = false;
let faceApi = null;

async function loadFaceApi() {
  if (faceApiLoaded && faceApi) return faceApi;
  if (faceApiLoading) {
    // Wait for ongoing load
    while (faceApiLoading) await new Promise(r => setTimeout(r, 200));
    return faceApi;
  }
  faceApiLoading = true;
  try {
    // Dynamically import via script tag
    if (!window.faceapi) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/dist/face-api.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    faceApi = window.faceapi;
    // Load required models
    await Promise.all([
      faceApi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceApi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      faceApi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    faceApiLoaded = true;
    return faceApi;
  } finally {
    faceApiLoading = false;
  }
}

const DETECT_OPTS = () => faceApi
  ? new faceApi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
  : null;

export default function FaceAuth({ mode, onSuccess, onCancel, userName }) {
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const streamRef  = useRef(null);
  const timerRef   = useRef(null);

  const [phase, setPhase]       = useState('loading'); // loading|ready|scanning|success|error|no_camera
  const [message, setMessage]   = useState('Loading face detection models…');
  const [progress, setProgress] = useState(0);
  const [countdown, setCountdown] = useState(null);
  // For enroll: collect multiple descriptors and average them
  const samplesRef = useRef([]);
  const MAX_SAMPLES = 5;

  // ── Stop camera on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopCamera();
      clearInterval(timerRef.current);
    };
  }, []);

  // ── Load models then open camera ──────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await loadFaceApi();
        if (!mounted) return;
        setMessage('Models ready. Starting camera…');
        await startCamera();
        if (!mounted) return;
        setPhase('ready');
        setMessage(mode === 'enroll'
          ? `Hold your face steady. We'll capture ${MAX_SAMPLES} samples.`
          : 'Position your face in the frame and click Verify.');
      } catch (err) {
        if (!mounted) return;
        if (err.name === 'NotAllowedError' || err.name === 'NotFoundError') {
          setPhase('no_camera');
          setMessage('Camera not available. Please allow camera access.');
        } else {
          setPhase('error');
          setMessage(`Setup failed: ${err.message}`);
        }
      }
    })();
    return () => { mounted = false; };
  }, [mode]);

  const startCamera = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
    });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await new Promise(r => { videoRef.current.onloadedmetadata = r; });
      await videoRef.current.play();
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  // ── Draw detection overlay ─────────────────────────────────────────────────
  const drawOverlay = useCallback((detection) => {
    const canvas = canvasRef.current;
    const video  = videoRef.current;
    if (!canvas || !video || !faceApi) return;
    const dims = faceApi.matchDimensions(canvas, video, true);
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    if (detection) {
      const resized = faceApi.resizeResults(detection, dims);
      faceApi.draw.drawDetections(canvas, resized);
      faceApi.draw.drawFaceLandmarks(canvas, resized);
    }
  }, []);

  // ── Enroll: capture N samples, average descriptor ─────────────────────────
  const handleEnroll = async () => {
    if (phase === 'scanning') return;
    setPhase('scanning');
    samplesRef.current = [];
    setProgress(0);

    const capture = async () => {
      if (!videoRef.current || !faceApi) return;
      const detection = await faceApi
        .detectSingleFace(videoRef.current, DETECT_OPTS())
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (!detection) {
        setMessage('No face detected. Please face the camera directly.');
        return;
      }
      drawOverlay(detection);
      samplesRef.current.push(Array.from(detection.descriptor));
      const done = samplesRef.current.length;
      setProgress(Math.round((done / MAX_SAMPLES) * 100));
      setCountdown(MAX_SAMPLES - done);
      setMessage(`Capturing… ${done}/${MAX_SAMPLES}`);

      if (done >= MAX_SAMPLES) {
        clearInterval(timerRef.current);
        // Average descriptors for better accuracy
        const avg = samplesRef.current[0].map((_, i) =>
          samplesRef.current.reduce((s, d) => s + d[i], 0) / MAX_SAMPLES
        );
        setCountdown(null);
        setPhase('success');
        setMessage('Face enrolled! ✓');
        stopCamera();
        setTimeout(() => onSuccess(avg), 600);
      }
    };

    timerRef.current = setInterval(capture, 800);
  };

  // ── Verify: single detection, compare client-side then pass descriptor ────
  const handleVerify = async () => {
    if (phase === 'scanning') return;
    setPhase('scanning');
    setMessage('Scanning face…');

    try {
      // Retry up to 5 times in case of brief no-detection
      let detection = null;
      for (let i = 0; i < 5; i++) {
        detection = await faceApi
          .detectSingleFace(videoRef.current, DETECT_OPTS())
          .withFaceLandmarks(true)
          .withFaceDescriptor();
        if (detection) break;
        await new Promise(r => setTimeout(r, 400));
      }
      if (!detection) {
        setPhase('ready');
        setMessage('No face detected. Look directly at the camera and try again.');
        return;
      }
      drawOverlay(detection);
      const descriptor = Array.from(detection.descriptor);
      setPhase('success');
      setMessage('Face detected! Verifying…');
      stopCamera();
      setTimeout(() => onSuccess(descriptor), 400);
    } catch (err) {
      setPhase('error');
      setMessage(`Detection error: ${err.message}`);
    }
  };

  // ── UI ─────────────────────────────────────────────────────────────────────
  const statusColor = phase === 'success' ? 'var(--green)'
    : phase === 'error' || phase === 'no_camera' ? 'var(--red)'
    : phase === 'scanning' ? 'var(--accent)'
    : 'var(--text2)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>

      {/* Header */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 6 }}>{mode === 'enroll' ? '👤' : '🔍'}</div>
        <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 18, marginBottom: 4 }}>
          {mode === 'enroll' ? 'Enroll Face' : 'Face Verification'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>
          {mode === 'enroll' ? `Registering face for ${userName}` : `Verifying identity of ${userName}`}
        </div>
      </div>

      {/* Camera frame */}
      <div style={{
        position: 'relative', width: 280, height: 210, borderRadius: 14, overflow: 'hidden',
        background: 'var(--bg3)', border: `2px solid ${phase === 'success' ? 'var(--green)' : phase === 'scanning' ? 'var(--accent)' : 'var(--border)'}`,
        transition: 'border-color 0.3s'
      }}>
        <video
          ref={videoRef}
          muted playsInline autoPlay
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
        />
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', transform: 'scaleX(-1)' }}
        />

        {/* Corner brackets */}
        {['top:0;left:0;borderTop:2px;borderLeft:2px', 'top:0;right:0;borderTop:2px;borderRight:2px',
          'bottom:0;left:0;borderBottom:2px;borderLeft:2px', 'bottom:0;right:0;borderBottom:2px;borderRight:2px'
        ].map((s, i) => {
          const styles = {};
          s.split(';').forEach(p => { const [k, v] = p.split(':'); if (k && v) styles[k] = v === '2px' ? '2px solid var(--accent)' : v; });
          return <div key={i} style={{ position: 'absolute', width: 20, height: 20, ...styles, opacity: phase === 'scanning' ? 1 : 0.4, transition: 'opacity 0.3s' }} />;
        })}

        {/* Overlay states */}
        {(phase === 'loading' || phase === 'no_camera') && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(8,12,24,0.85)', flexDirection: 'column', gap: 8 }}>
            {phase === 'loading' ? (
              <><div className="pulsing" style={{ fontSize: 28 }}>⟳</div><div style={{ fontSize: 12, color: 'var(--text2)' }}>Loading models…</div></>
            ) : (
              <><div style={{ fontSize: 28 }}>📷</div><div style={{ fontSize: 12, color: 'var(--red)', textAlign: 'center', padding: '0 12px' }}>Camera unavailable</div></>
            )}
          </div>
        )}
        {phase === 'success' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(52,211,153,0.15)' }}>
            <div style={{ fontSize: 48, animation: 'slideUp 0.3s ease' }}>✓</div>
          </div>
        )}

        {/* Progress bar for enroll */}
        {mode === 'enroll' && phase === 'scanning' && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: 'rgba(0,0,0,0.4)' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'var(--green)', transition: 'width 0.3s' }} />
          </div>
        )}

        {/* Countdown badge */}
        {countdown !== null && countdown > 0 && (
          <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.7)', color: 'white', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontFamily: 'var(--mono)' }}>
            {countdown} left
          </div>
        )}
      </div>

      {/* Status message */}
      <div style={{ fontSize: 13, color: statusColor, textAlign: 'center', maxWidth: 280, lineHeight: 1.5 }}>
        {message}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 280 }}>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onCancel}>
          Cancel
        </button>
        {mode === 'enroll' && phase !== 'scanning' && phase !== 'success' && phase !== 'loading' && (
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={handleEnroll}
            disabled={phase === 'loading' || phase === 'no_camera'}
          >
            Start Enroll
          </button>
        )}
        {mode === 'verify' && phase !== 'scanning' && phase !== 'success' && phase !== 'loading' && (
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={handleVerify}
            disabled={phase === 'loading' || phase === 'no_camera'}
          >
            Verify Face
          </button>
        )}
        {phase === 'scanning' && mode === 'enroll' && (
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { clearInterval(timerRef.current); setPhase('ready'); setProgress(0); samplesRef.current = []; setCountdown(null); setMessage(`Hold your face steady. We'll capture ${MAX_SAMPLES} samples.`); }}>
            Retry
          </button>
        )}
      </div>

      {/* Notice */}
      <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'center', maxWidth: 280 }}>
        Face processing happens entirely in your browser. No images are stored — only a numeric descriptor.
      </div>
    </div>
  );
}
