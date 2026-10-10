/**
 * CONSOL NewSampleModal Component
 * Native React 19 Specimen Registration & In-situ Evidence Capture.
 * 
 * Features:
 * - Material classification selection (AHM, ACC, ACX, OTH)
 * - Server-side sequence preview (api.peekId)
 * - Multi-mode camera capture (visible, UV fluorescence, phosphorescence video)
 * - Index-safe local file selection
 * - Resilient upload pipeline retaining failed evidence without session loss
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/supabase';
import {
  ShotItem,
  createShotItem,
  revokeShotUrl,
  uploadEvidenceShot
} from '../../services/acquisition';
import {
  SPECIMEN_TYPES,
  SPECIMEN_TYPE_BY_CODE,
  SpecimenCode,
  CaptureKind
} from '../../types';

interface NewSampleModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewSampleModal: React.FC<NewSampleModalProps> = ({ isOpen, onClose }) => {
  const { navigate, toast } = useApp();

  // Specimen Metadata State
  const [code, setCode] = useState<SpecimenCode>('AHM');
  const [idPreview, setIdPreview] = useState<string>('—');
  const [location, setLocation] = useState<string>('Andamooka, South Australia');
  const [weight, setWeight] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Acquisition State
  const [captureKind, setCaptureKind] = useState<CaptureKind>('visible');
  const [shots, setShots] = useState<ShotItem[]>([]);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Submission & Recovery State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [createdSampleId, setCreatedSampleId] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Update proposed ID preview when material class changes
  useEffect(() => {
    let active = true;
    api.peekId(code)
      .then(preview => {
        if (active) setIdPreview(preview || `${code}-000001`);
      })
      .catch(() => {
        if (active) setIdPreview(`${code}-000001`);
      });
    return () => { active = false; };
  }, [code]);

  // Clean up camera stream and object URLs on unmount or close
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
      setCreatedSampleId(null);
    }
  }, [isOpen, cleanupMedia]);

  const handleStartCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera API is not supported in this browser environment. Use local media selection.');
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
      setCameraError(`Camera access declined or unavailable (${msg}). Use Choose media.`);
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
      const file = new File(
        [blob],
        `${captureKind}-${Date.now()}.jpg`,
        { type: 'image/jpeg' }
      );
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
      setFormError('Video recording is unsupported in this browser.');
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
      setFormError(`Recording initialization failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  /**
   * Safe file selection:
   * Explicitly avoids the original defect where array indices were passed as capture types.
   */
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

  // Submit Registration and Upload Evidence
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setFormError(null);

    // Validate weight
    const cleanWeight = weight.trim();
    let numWeight: number | null = null;
    if (cleanWeight !== '') {
      numWeight = Number(cleanWeight);
      if (!Number.isFinite(numWeight) || numWeight < 0) {
        setFormError('Enter a valid non-negative weight in grams, or leave blank.');
        return;
      }
    }

    setIsSubmitting(true);
    setSubmitStatus('Creating specimen identity…');

    let specimenIdToUse = createdSampleId;

    try {
      // Step 1: Create physical specimen record if not already created in a previous partial attempt
      if (!specimenIdToUse) {
        const info = SPECIMEN_TYPE_BY_CODE[code] || SPECIMEN_TYPES[3];
        const newSpecimen = await api.addSample({
          sample_code: code,
          sample_type: info.name,
          location: location.trim(),
          weight_g: numWeight,
          dimensions: null,
          notes: notes.trim() || null
        });
        specimenIdToUse = newSpecimen.id;
        setCreatedSampleId(newSpecimen.id);
      }

      // Step 2: Upload evidence items sequentially
      const totalShots = shots.length;
      let failedCount = 0;

      for (let i = 0; i < totalShots; i++) {
        const shot = shots[i];
        if (shot.state === 'saved') continue; // already uploaded successfully

        setSubmitStatus(`Preserving evidence ${i + 1} of ${totalShots}…`);
        shot.state = 'uploading';
        setShots([...shots]);

        try {
          await uploadEvidenceShot(specimenIdToUse, shot);
          setShots([...shots]);
        } catch (uploadErr) {
          console.error('[Evidence Upload Error]', uploadErr);
          failedCount++;
          setShots([...shots]);
        }
      }

      // Step 3: Handle outcome
      if (failedCount > 0) {
        setIsSubmitting(false);
        setSubmitStatus('');
        setFormError(
          `Specimen ${specimenIdToUse} was created, but ${failedCount} media item${failedCount === 1 ? '' : 's'} failed to upload. Unsaved media remains in this session. Tap "Retry Uploads" to resume without re-registering.`
        );
        toast(`Specimen ${specimenIdToUse} registered with ${failedCount} pending uploads`, 'error');
      } else {
        // Full success
        cleanupMedia();
        shots.forEach(revokeShotUrl);
        setShots([]);
        setIsSubmitting(false);
        onClose();
        toast(`${specimenIdToUse} registered`);
        navigate(`#/samples/${encodeURIComponent(specimenIdToUse)}`);
      }
    } catch (err) {
      setIsSubmitting(false);
      setSubmitStatus('');
      const msg = err instanceof Error ? err.message : String(err);
      setFormError(`Registration failed: ${msg}`);
    }
  };

  const handleSafeClose = () => {
    if (shots.length > 0 && !createdSampleId) {
      const confirmDiscard = window.confirm(
        'You have captured media items in this session. Closing will discard unsaved items. Discard and close?'
      );
      if (!confirmDiscard) return;
    }
    cleanupMedia();
    onClose();
  };

  if (!isOpen) return null;

  const currentTypeInfo = SPECIMEN_TYPE_BY_CODE[code] || SPECIMEN_TYPES[3];

  return (
    <div className="modal" id="modal" style={{ display: 'flex' }}>
      <div className="modal-box" tabIndex={-1} style={{ maxWidth: 640 }}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">New specimen</span>
            <h2 className="modal-title">Give the stone an identity.</h2>
            <p className="sub">
              Choose the material class. ProvenanceOS assigns the next number; you never type it.
            </p>
          </div>
          <button className="close" onClick={handleSafeClose} disabled={isSubmitting}>
            ×
          </button>
        </div>

        {/* Proposed Identifier Preview */}
        <div className="identity-preview">
          <div id="id-preview">{createdSampleId ? createdSampleId : idPreview}</div>
          <small>
            {createdSampleId
              ? 'authoritative database identity'
              : 'proposed database-assigned preview'}
          </small>
        </div>

        {/* Material Class Selection */}
        <div className="type-grid">
          {SPECIMEN_TYPES.map(t => (
            <button
              key={t.code}
              type="button"
              className={`type-choice ${code === t.code ? 'selected' : ''}`}
              onClick={() => {
                if (!createdSampleId) setCode(t.code);
              }}
              disabled={Boolean(createdSampleId) || isSubmitting}
            >
              <span>{t.code}</span>
              <strong>{t.name}</strong>
              <small>{t.note}</small>
            </button>
          ))}
        </div>

        <div className="capture-note" style={{ margin: '14px 0', fontSize: 12, color: 'var(--muted)' }}>
          Classification is recorded as field context: {currentTypeInfo.short}. Use Unknown / Other when uncertain.
        </div>

        <form onSubmit={handleSubmit}>
          {/* Metadata Fields */}
          <div className="fields">
            <div className="field">
              <label htmlFor="f-location">Location</label>
              <input
                id="f-location"
                value={location}
                onChange={e => setLocation(e.target.value)}
                disabled={Boolean(createdSampleId) || isSubmitting}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="f-weight">Weight (g)</label>
              <input
                id="f-weight"
                inputMode="decimal"
                placeholder="Optional"
                value={weight}
                onChange={e => setWeight(e.target.value)}
                disabled={Boolean(createdSampleId) || isSubmitting}
              />
            </div>
            <div className="field full">
              <label htmlFor="f-notes">Notes</label>
              <textarea
                id="f-notes"
                placeholder="Context worth preserving…"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                disabled={Boolean(createdSampleId) || isSubmitting}
              />
            </div>
          </div>

          {/* Evidence Capture & Camera Stage */}
          <div className="capture-block" style={{ marginTop: 22 }}>
            <div className="capture-switch">
              {(['visible', 'fluorescence', 'phosphorescence'] as CaptureKind[]).map(k => (
                <button
                  key={k}
                  type="button"
                  className={`mode ${captureKind === k ? 'active' : ''}`}
                  onClick={() => setCaptureKind(k)}
                >
                  {k === 'visible' ? 'Visible' : k === 'fluorescence' ? 'Fluorescence' : 'Phosphorescence'}
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
                  <span>Place specimen inside frame</span>
                  <small>
                    {cameraError ? cameraError : 'Original capture will be preserved.'}
                  </small>
                </div>
              )}
            </div>

            {/* Camera & File Selection Controls */}
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

              <label
                className="secondary file-label"
                style={{ position: 'relative', overflow: 'hidden', cursor: 'pointer' }}
              >
                Choose media
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*,.jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov,.webm"
                  multiple
                  onChange={handleFileSelect}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    opacity: 0,
                    cursor: 'pointer'
                  }}
                />
              </label>
            </div>

            {/* Selected / Captured Shots List */}
            {shots.length > 0 && (
              <div className="shots" style={{ marginTop: 14 }}>
                {shots.map((shot, idx) => {
                  const isVideo = shot.mime.startsWith('video/');
                  return (
                    <div key={shot.id} className="shot">
                      <div className="shot-media">
                        {isVideo ? (
                          <video muted src={shot.url} />
                        ) : (
                          <img src={shot.url} alt={shot.captureKind} />
                        )}
                        <span>{shot.captureKind}</span>
                      </div>
                      <div className="shot-actions">
                        <span style={{ fontSize: 10, color: shot.state === 'saved' ? 'var(--aqua)' : shot.state === 'failed' ? 'var(--danger)' : 'var(--muted)' }}>
                          {shot.state.toUpperCase()}
                        </span>
                        {shot.state !== 'saved' && (
                          <button
                            type="button"
                            onClick={() => handleRemoveShot(idx)}
                            disabled={isSubmitting}
                          >
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

          {formError && (
            <div className="form-error" style={{ marginTop: 16 }}>
              {formError}
            </div>
          )}

          {/* Action Buttons */}
          <div className="actions" style={{ marginTop: 24 }}>
            <button
              type="button"
              className="secondary"
              onClick={handleSafeClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? submitStatus || 'Processing…'
                : createdSampleId
                  ? 'Retry Uploads'
                  : 'Register specimen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NewSampleModal;
