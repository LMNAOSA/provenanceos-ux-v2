/**
 * CONSOL EvidenceModal Component
 * Native React 19 in-situ evidence capture for an existing physical specimen.
 * Supports Visible light, UV fluorescence, and Phosphorescence capture modes.
 * Enforces resilient upload state machine and retains evidence on network/storage errors.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import {
  ShotItem,
  createShotItem,
  revokeShotUrl,
  uploadEvidenceShot
} from '../../services/acquisition';
import type { CaptureKind } from '../../types';

interface EvidenceModalProps {
  isOpen: boolean;
  sampleId: string | null;
  initialKind?: CaptureKind;
  onClose: () => void;
  onSuccess?: () => void;
}

export const EvidenceModal: React.FC<EvidenceModalProps> = ({
  isOpen,
  sampleId,
  initialKind = 'visible',
  onClose,
  onSuccess
}) => {
  const { toast } = useApp();

  const [captureKind, setCaptureKind] = useState<CaptureKind>(initialKind);
  const [shots, setShots] = useState<ShotItem[]>([]);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    setCaptureKind(initialKind);
  }, [initialKind]);

  const cleanupMedia = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    setIsCameraActive(false);
    setIsRecording(false);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      cleanupMedia();
      shots.forEach(revokeShotUrl);
      setShots([]);
      setFormError(null);
    }
  }, [isOpen, cleanupMedia]);

  const handleStartCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera API unsupported in this environment. Use Choose media.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setIsCameraActive(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCameraError(`Camera unavailable (${msg}). Use Choose media.`);
      setIsCameraActive(false);
    }
  };

  const handleStopCamera = () => {
    cleanupMedia();
  };

  const handleCapturePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], `${captureKind}-${Date.now()}.jpg`, { type: 'image/jpeg' });
      try {
        const item = createShotItem(file, captureKind);
        setShots(prev => [...prev, item]);
      } catch (err) {
        setFormError(err instanceof Error ? err.message : String(err));
      }
    }, 'image/jpeg', 0.94);
  };

  const handleStartRecording = () => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === 'undefined') {
      setFormError('Video recording is unsupported.');
      return;
    }

    const mime = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(m =>
      MediaRecorder.isTypeSupported(m)
    );

    recordedChunksRef.current = [];
    try {
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = rec;

      rec.ondataavailable = e => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      rec.onstop = () => {
        const type = rec.mimeType || mime || 'video/webm';
        const blob = new Blob(recordedChunksRef.current, { type });
        if (blob.size > 0) {
          const ext = type.includes('mp4') ? 'mp4' : 'webm';
          const file = new File([blob], `${captureKind}-${Date.now()}.${ext}`, { type });
          try {
            const item = createShotItem(file, captureKind);
            setShots(prev => [...prev, item]);
          } catch (err) {
            setFormError(err instanceof Error ? err.message : String(err));
          }
        }
        recordedChunksRef.current = [];
        setIsRecording(false);
      };

      rec.start(300);
      setIsRecording(true);
    } catch (err) {
      setFormError(`Video initialization failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';

    const newShots: ShotItem[] = [];
    for (const f of files) {
      try {
        const item = createShotItem(f, captureKind);
        newShots.push(item);
      } catch (err) {
        setFormError(err instanceof Error ? err.message : String(err));
      }
    }
    if (newShots.length > 0) {
      setShots(prev => [...prev, ...newShots]);
    }
  };

  const handleRemoveShot = (index: number) => {
    setShots(prev => {
      const copy = [...prev];
      const removed = copy.splice(index, 1)[0];
      if (removed) revokeShotUrl(removed);
      return copy;
    });
  };

  const handleSubmit = async () => {
    if (!sampleId) {
      setFormError('No target specimen identity specified.');
      return;
    }
    if (shots.length === 0) {
      setFormError('Capture or choose at least one evidence item.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    let failedCount = 0;
    let savedCount = 0;
    const total = shots.length;

    for (let i = 0; i < total; i++) {
      const shot = shots[i];
      if (shot.state === 'saved') {
        savedCount++;
        continue;
      }

      setSubmitProgress(`Preserving evidence ${i + 1} of ${total}…`);
      shot.state = 'uploading';
      setShots([...shots]);

      try {
        await uploadEvidenceShot(sampleId, shot);
        savedCount++;
        setShots([...shots]);
      } catch (err) {
        console.error('[Upload error]', err);
        failedCount++;
        setShots([...shots]);
      }
    }

    setIsSubmitting(false);
    setSubmitProgress('');

    if (failedCount > 0) {
      setFormError(
        `${failedCount} item${failedCount === 1 ? '' : 's'} failed to upload. Unsaved evidence remains in session memory. Tap "Retry" to continue.`
      );
      toast(`${savedCount} saved · ${failedCount} pending retry`, 'error');
    } else {
      cleanupMedia();
      shots.forEach(revokeShotUrl);
      setShots([]);
      toast(`${savedCount} evidence item${savedCount === 1 ? '' : 's'} preserved for ${sampleId}`);
      if (onSuccess) onSuccess();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal" id="modal" style={{ display: 'flex' }}>
      <div className="modal-box" tabIndex={-1} style={{ maxWidth: 640 }}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">Evidence capture</span>
            <h2 className="modal-title">
              {sampleId ? `Attach to ${sampleId}` : 'Preserve Evidence'}
            </h2>
            <p className="sub">
              Original media is preserved and hashed with SHA-256. Derived presentation cutouts
              are stored separately.
            </p>
          </div>
          <button className="close" onClick={onClose} disabled={isSubmitting}>
            ×
          </button>
        </div>

        <div className="capture-block">
          <div className="capture-switch">
            {(['visible', 'fluorescence', 'phosphorescence'] as CaptureKind[]).map(k => (
              <button
                key={k}
                type="button"
                className={`mode ${captureKind === k ? 'active' : ''}`}
                onClick={() => setCaptureKind(k)}
              >
                {k === 'visible' ? 'Visible light' : k === 'fluorescence' ? 'Fluorescence' : 'Phosphorescence'}
              </button>
            ))}
          </div>

          <div className="camera" style={{ position: 'relative', minHeight: 220, overflow: 'hidden' }}>
            {isCameraActive ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div className="camera-guide">
                <span>Ready to capture</span>
                <small>{cameraError ? cameraError : 'Use consistent lighting conditions.'}</small>
              </div>
            )}
          </div>

          <div className="camera-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {isRecording ? (
              <button type="button" className="recording" onClick={handleStopRecording}>
                ● Stop recording
              </button>
            ) : isCameraActive ? (
              <>
                <button type="button" className="primary" onClick={handleCapturePhoto}>
                  Capture photo
                </button>
                <button type="button" className="secondary" onClick={handleStartRecording}>
                  Record video
                </button>
                <button type="button" className="secondary" onClick={handleStopCamera}>
                  Close camera
                </button>
              </>
            ) : (
              <button type="button" className="primary" onClick={handleStartCamera}>
                Open camera
              </button>
            )}

            <label className="secondary file-label" style={{ cursor: 'pointer' }}>
              Choose media
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                hidden
                onChange={handleFileSelect}
              />
            </label>
          </div>

          {shots.length > 0 && (
            <div className="shots" style={{ marginTop: 14 }}>
              {shots.map((shot, idx) => {
                const isVideo = shot.mime.startsWith('video/');
                return (
                  <div key={shot.id} className="shot">
                    <div className="shot-media">
                      {isVideo ? <video muted src={shot.url} /> : <img src={shot.url} alt={shot.captureKind} />}
                      <span>{shot.captureKind}</span>
                    </div>
                    <div className="shot-actions">
                      <span style={{ fontSize: 10, color: shot.state === 'saved' ? 'var(--aqua)' : shot.state === 'failed' ? 'var(--danger)' : 'var(--muted)' }}>
                        {shot.state.toUpperCase()}
                      </span>
                      {shot.state !== 'saved' && (
                        <button type="button" onClick={() => handleRemoveShot(idx)} disabled={isSubmitting}>
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="evidence-instructions" style={{ margin: '14px 0', fontSize: 12, color: 'var(--muted)' }}>
          For fluorescence and phosphorescence, record excitation source and wavelength in notes when available.
        </div>

        {formError && (
          <div className="form-error" style={{ marginBottom: 16 }}>
            {formError}
          </div>
        )}

        <div className="actions" style={{ marginTop: 20 }}>
          <button type="button" className="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? submitProgress || 'Preserving…' : 'Preserve evidence'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EvidenceModal;
