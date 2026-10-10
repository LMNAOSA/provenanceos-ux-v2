/**
 * CONSOL — SOLOPTICS Mobile-First Optical Acquisition Instrument (v1.0)
 *
 * Implements:
 * - BUILD 1: Mobile Capture Interface under the Visualisation pillar (#/soloptics and #/soloptics/:id)
 *   • Supports empty specimen registry gracefully: allows registering a new specimen via NewSampleModal
 *     and returning seamlessly to the active SOLOPTICS workflow without creating orphaned specimen records.
 *   • Full-screen, touch-optimised acquisition interface with minimal chrome, large accessible controls (>= 48px)
 *     and clear capture guidance.
 * - BUILD 2: Guided Dual-Pass Optical Capture
 *   • Pass A — Physical Appearance (Front, Reverse, Side/Profile, Additional Coverage, Optional Scale/Colour Reference)
 *   • Pass B — Play-of-Colour (Fixed directional light, multi-view ordered still sequence View 01–05 + optional slow video sweep)
 *   • Preserves original files & exposure metadata; flags AE/AWB and unsupported camera controls as acquisition limitations.
 * - BUILD 3: Practical Capture Quality Checks
 *   • Live Laplacian focus/blur evaluation, highlight clipping & underexposure checks, resolution verification,
 *     Pass A / Pass B completeness tracking, and scale/colour reference indicators.
 * - BUILD 4: Acquisition Metadata Contract
 *   • Records Specimen ID, Session ID, Operator, Timestamps, Pass/Role, Sequence Order, Device/Browser & Camera Track
 *     Capabilities, Illumination Type & Direction, Background Surface, Scale & Colour References, and SHA-256 hashes.
 * - BUILD 5: Reliable Upload and Recovery
 *   • Explicit states: Pending -> Uploading -> Saved | Failed | Retryable
 *   • Retains unsaved captures on partial failure for retry without re-uploading already stored blobs.
 * - BUILD 6: Handoff to SOLARIUM & Specimen Record
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/supabase';
import { resolveMediaMime } from '../../services/media';
import {
  SOLOPTICS_STEPS,
  SolopticsPassId,
  SolopticsStepRole,
  SolopticsCaptureConditions,
  SolopticsCapturedAsset,
  CameraHardwareCapabilities,
  ILLUMINATION_TYPE_LABELS,
  ILLUMINATION_DIRECTION_LABELS,
  BACKGROUND_SURFACE_LABELS,
  IlluminationSourceType,
  IlluminationDirectionPreset,
  BackgroundSurfaceType,
  extractCameraCapabilities,
  evaluateFrameQuality,
  evaluateSessionQualitySummary,
  uploadSolopticsAsset,
  finalizeSolopticsSession,
  fetchSpecimenSolopticsSessions,
  HydratedSolopticsSession
} from '../../services/soloptics';
import { SPECIMEN_TYPE_BY_CODE, SPECIMEN_TYPES, SpecimenOverview } from '../../types';

export type SolopticsStage = 'setup' | 'capture' | 'review' | 'completed';

export const SolopticsView: React.FC = () => {
  const {
    specimenId: routeSpecimenId,
    activeSpecimenId,
    setActiveSpecimenId,
    immersiveMode,
    setImmersiveMode,
    railCollapsed,
    setRailCollapsed,
    navigate,
    openModal,
    toast
  } = useApp();
  const { user } = useAuth();

  // Specimen Registry State
  const [specimens, setSpecimens] = useState<SpecimenOverview[]>([]);
  const [loadingSpecimens, setLoadingSpecimens] = useState<boolean>(true);
  const [selectedSampleId, setSelectedSampleId] = useState<string>(
    routeSpecimenId || activeSpecimenId || ''
  );

  // Existing saved SOLOPTICS sessions for the selected specimen
  const [priorSessions, setPriorSessions] = useState<HydratedSolopticsSession[]>([]);

  // Active Acquisition Session Identity
  const [sessionId, setSessionId] = useState<string>(() =>
    `SOL-${Date.now().toString(36).toUpperCase().slice(-6)}`
  );
  const [sessionStartedAt, setSessionStartedAt] = useState<string>(() => new Date().toISOString());
  const [stage, setStage] = useState<SolopticsStage>('setup');

  // Guided Pass & Step State
  const [activePass, setActivePass] = useState<SolopticsPassId>('pass_a_appearance');
  const [activeStepRole, setActiveStepRole] = useState<SolopticsStepRole>('front_surface');

  // Acquisition Conditions State (BUILD 4)
  const [conditions, setConditions] = useState<SolopticsCaptureConditions>(() => ({
    operatorEmail: user?.email || 'Authorised Field Operator',
    captureKind: 'visible',
    illuminationType: 'diffuse_daylight_white',
    illuminationDirection: 'overhead_90deg',
    illuminationDistanceCm: '20',
    illuminationNotes: '',
    backgroundSurface: 'matte_black_velvet',
    scaleReferencePresent: false,
    scaleReferenceMm: '10',
    colourReferencePresent: false,
    colourReferenceNote: '',
    sessionNotes: ''
  }));

  // Update operator email when auth resolves
  useEffect(() => {
    if (user?.email) {
      setConditions(prev => ({ ...prev, operatorEmail: user.email! }));
    }
  }, [user?.email]);

  // Collected Evidence Assets in Current Session
  const [assets, setAssets] = useState<SolopticsCapturedAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  // Camera & Recording State (iPhone Safari & Android Chrome compatible)
  const [isCameraLive, setIsCameraLive] = useState<boolean>(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraCaps, setCameraCaps] = useState<CameraHardwareCapabilities>(() =>
    extractCameraCapabilities(null)
  );
  const [torchActive, setTorchActive] = useState<boolean>(false);

  // Upload & Persistence State (BUILD 5)
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgressText, setUploadProgressText] = useState<string>('');
  const [uploadBannerError, setUploadBannerError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);
  const filePickerInputRef = useRef<HTMLInputElement | null>(null);

  // Load specimens from Supabase and listen for new specimen registrations (BUILD 1 empty registry return flow)
  const loadSpecimenRegistry = useCallback(async () => {
    setLoadingSpecimens(true);
    try {
      const list = await api.overview({ limit: 300 });
      setSpecimens(list);
      const preferred =
        routeSpecimenId ||
        activeSpecimenId ||
        (list.length > 0 ? list[0].id : '');
      if (preferred) {
        setSelectedSampleId(preferred);
        setActiveSpecimenId(preferred);
      }
    } catch {
      // keep existing state if offline
    } finally {
      setLoadingSpecimens(false);
    }
  }, [routeSpecimenId, activeSpecimenId, setActiveSpecimenId]);

  useEffect(() => {
    loadSpecimenRegistry();
    const onUpdated = () => {
      loadSpecimenRegistry();
    };
    window.addEventListener('consol:data-updated', onUpdated);
    window.addEventListener('hashchange', onUpdated);
    return () => {
      window.removeEventListener('consol:data-updated', onUpdated);
      window.removeEventListener('hashchange', onUpdated);
    };
  }, [loadSpecimenRegistry]);

  // Sync route specimenId if URL changes
  useEffect(() => {
    if (routeSpecimenId && routeSpecimenId !== selectedSampleId) {
      setSelectedSampleId(routeSpecimenId);
    }
  }, [routeSpecimenId, selectedSampleId]);

  // Load prior saved SOLOPTICS sessions for the selected specimen
  useEffect(() => {
    let active = true;
    if (!selectedSampleId) {
      setPriorSessions([]);
      return;
    }
    fetchSpecimenSolopticsSessions(selectedSampleId)
      .then(sessions => {
        if (active) setPriorSessions(sessions);
      })
      .catch(() => {
        if (active) setPriorSessions([]);
      });
    return () => {
      active = false;
    };
  }, [selectedSampleId, stage]);

  // Warn before accidental tab closure if unsaved captures exist in memory (Directive §8)
  const hasUnsavedCaptures = useMemo(
    () => assets.some(a => a.uploadState !== 'saved'),
    [assets]
  );

  useEffect(() => {
    if (!hasUnsavedCaptures) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedCaptures]);

  // Stop live camera stream cleanly
  const stopCameraStream = useCallback(() => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setIsCameraLive(false);
    setIsRecordingVideo(false);
    setTorchActive(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCameraStream();
      assets.forEach(a => {
        if (a.previewUrl && typeof URL !== 'undefined') {
          URL.revokeObjectURL(a.previewUrl);
        }
      });
    };
  }, [stopCameraStream]);

  // Start rear camera stream optimised for iPhone Safari & Android Chrome
  const startCameraStream = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        'Live WebRTC viewfinder is unavailable in this browser context. Use the Native Camera / Photo button below to capture full-resolution sensor frames.'
      );
      return;
    }

    try {
      stopCameraStream();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1440 }
        },
        audio: false
      });

      streamRef.current = stream;
      const videoTrack = stream.getVideoTracks()[0] || null;
      setCameraCaps(extractCameraCapabilities(videoTrack));

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setIsCameraLive(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCameraError(
        `Live viewfinder permission declined or unavailable (${msg}). Use Native Camera / File Capture below.`
      );
      setIsCameraLive(false);
    }
  };

  // Toggle hardware torch if supported on mobile rear camera
  const handleToggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchActive;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (track as any).applyConstraints({ advanced: [{ torch: next }] });
      setTorchActive(next);
    } catch {
      toast('Hardware torch control is not supported by this camera lens.', 'info');
    }
  };

  const currentStepDef = useMemo(
    () =>
      SOLOPTICS_STEPS.find(s => s.role === activeStepRole) ||
      SOLOPTICS_STEPS[0],
    [activeStepRole]
  );

  const stepsForActivePass = useMemo(
    () => SOLOPTICS_STEPS.filter(s => s.pass === activePass),
    [activePass]
  );

  // Switch pass and automatically align default illumination & first step
  const handleSwitchPass = (pass: SolopticsPassId) => {
    setActivePass(pass);
    if (pass === 'pass_a_appearance') {
      setActiveStepRole('front_surface');
      setConditions(prev => ({
        ...prev,
        illuminationType:
          prev.illuminationType === 'fixed_directional_led'
            ? 'diffuse_daylight_white'
            : prev.illuminationType,
        illuminationDirection: 'overhead_90deg'
      }));
    } else {
      setActiveStepRole('poc_view_1');
      setConditions(prev => ({
        ...prev,
        illuminationType:
          prev.illuminationType === 'diffuse_daylight_white'
            ? 'fixed_directional_led'
            : prev.illuminationType,
        illuminationDirection: 'oblique_45deg_front'
      }));
    }
  };

  // Advance to the next logical step in the active pass after capturing a frame
  const advanceToNextStep = useCallback(
    (justCompletedRole: SolopticsStepRole) => {
      const passSteps = SOLOPTICS_STEPS.filter(s => s.pass === activePass);
      const idx = passSteps.findIndex(s => s.role === justCompletedRole);
      if (idx >= 0 && idx + 1 < passSteps.length) {
        setActiveStepRole(passSteps[idx + 1].role);
      }
    },
    [activePass]
  );

  // Register a captured File into the current SOLOPTICS session with real quality evaluation
  const ingestCapturedFile = useCallback(
    async (file: File, roleOverride?: SolopticsStepRole) => {
      if (!selectedSampleId) {
        toast('Select or register an authoritative CONSOL specimen first.', 'error');
        return;
      }

      const targetRole = roleOverride || activeStepRole;
      const stepDef =
        SOLOPTICS_STEPS.find(s => s.role === targetRole) || currentStepDef;
      const mime = resolveMediaMime(file) || file.type || 'image/jpeg';
      const isVideo = mime.startsWith('video/');

      // Evaluate focus/blur, exposure clipping & resolution
      const quality = await evaluateFrameQuality(file);
      const track = streamRef.current?.getVideoTracks()[0] || null;
      const caps = extractCameraCapabilities(track);

      // If scale_colour_reference step was captured, mark scale/colour flags
      if (targetRole === 'scale_colour_reference') {
        setConditions(prev => ({
          ...prev,
          scaleReferencePresent: true,
          colourReferencePresent: true
        }));
      }

      const previewUrl =
        typeof URL !== 'undefined' ? URL.createObjectURL(file) : '';

      const samePassAssets = assets.filter(a => a.pass === stepDef.pass);
      const sequenceOrder = samePassAssets.length + 1;

      const newAsset: SolopticsCapturedAsset = {
        id:
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `sol-asset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sessionId,
        sampleId: selectedSampleId,
        pass: stepDef.pass,
        stepRole: targetRole,
        sequenceOrder,
        viewLabel: `${stepDef.shortLabel} (${stepDef.label})`,
        file,
        previewUrl,
        mimeType: mime,
        sizeBytes: file.size,
        isVideo,
        captureKind: conditions.captureKind,
        capturedAt: new Date().toISOString(),
        quality,
        cameraCapabilities: caps,
        uploadState: 'pending'
      };

      setAssets(prev => [...prev, newAsset]);
      setSelectedAssetId(newAsset.id);

      if (quality.status === 'warning' && quality.warnings.length > 0) {
        toast(`Captured ${stepDef.shortLabel} — Quality note: ${quality.warnings[0]}`, 'info');
      } else {
        toast(`Captured ${stepDef.shortLabel} · Sharpness ${quality.sharpnessScore}`, 'info');
      }

      advanceToNextStep(targetRole);
    },
    [
      selectedSampleId,
      activeStepRole,
      currentStepDef,
      assets,
      sessionId,
      conditions.captureKind,
      toast,
      advanceToNextStep
    ]
  );

  // Capture photo frame from live WebRTC video element
  const handleCaptureLiveStill = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      nativeCameraInputRef.current?.click();
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      blob => {
        if (!blob) return;
        const fileName = `${selectedSampleId || 'SPECIMEN'}_${sessionId}_${activeStepRole}_${Date.now()}.jpg`;
        const file = new File([blob], fileName, { type: 'image/jpeg' });
        ingestCapturedFile(file, activeStepRole);
      },
      'image/jpeg',
      0.95
    );
  };

  // Start/Stop Play-of-Colour video sweep in Pass B
  const handleStartVideoSweep = () => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === 'undefined') {
      toast('Live video recording unsupported here — use Native Camera / File button.', 'info');
      return;
    }

    const supportedMime = [
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm',
      'video/quicktime'
    ].find(m => {
      try {
        return MediaRecorder.isTypeSupported(m);
      } catch {
        return false;
      }
    });

    recordedChunksRef.current = [];
    try {
      const rec = new MediaRecorder(
        stream,
        supportedMime ? { mimeType: supportedMime } : undefined
      );
      recorderRef.current = rec;

      rec.ondataavailable = e => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      rec.onstop = () => {
        if (recordingTimerRef.current) {
          window.clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        const finalType = rec.mimeType || supportedMime || 'video/mp4';
        const blob = new Blob(recordedChunksRef.current, { type: finalType });
        if (blob.size > 0) {
          const ext = finalType.includes('mp4')
            ? 'mp4'
            : finalType.includes('quicktime')
              ? 'mov'
              : 'webm';
          const fileName = `${selectedSampleId || 'SPECIMEN'}_${sessionId}_poc_sweep_${Date.now()}.${ext}`;
          const file = new File([blob], fileName, { type: finalType });
          ingestCapturedFile(file, 'poc_motion_video');
        }
        recordedChunksRef.current = [];
        setIsRecordingVideo(false);
        setRecordingSeconds(0);
      };

      rec.start(250);
      setIsRecordingVideo(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds(s => s + 1);
      }, 1000);
    } catch (err) {
      toast(
        `Video capture could not start (${err instanceof Error ? err.message : String(err)}).`,
        'error'
      );
    }
  };

  const handleStopVideoSweep = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  };

  // Handle native OS camera / file input selection (primary path on iOS Safari when user prefers native camera)
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (!files.length) return;

    for (let i = 0; i < files.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      await ingestCapturedFile(files[i]);
    }
  };

  // Remove or retake a specific captured asset
  const handleRemoveAsset = (assetId: string) => {
    setAssets(prev => {
      const target = prev.find(a => a.id === assetId);
      if (target?.previewUrl && typeof URL !== 'undefined') {
        URL.revokeObjectURL(target.previewUrl);
      }
      const remaining = prev.filter(a => a.id !== assetId);
      if (selectedAssetId === assetId) {
        setSelectedAssetId(remaining[remaining.length - 1]?.id || null);
      }
      return remaining;
    });
  };

  const handleRetakeAsset = (asset: SolopticsCapturedAsset) => {
    setActivePass(asset.pass);
    setActiveStepRole(asset.stepRole);
    handleRemoveAsset(asset.id);
    setStage('capture');
  };

  // Session Quality Summary (BUILD 3)
  const qualitySummary = useMemo(
    () => evaluateSessionQualitySummary(assets, conditions),
    [assets, conditions]
  );

  // Persist all unsaved assets in the session to Supabase Storage + `sample_images` (BUILD 5)
  const handleCommitSession = async () => {
    if (!selectedSampleId) {
      toast('Select a registered specimen before saving optical evidence.', 'error');
      return;
    }
    if (assets.length === 0) {
      toast('Capture at least one optical frame before saving the session.', 'error');
      return;
    }

    setIsUploading(true);
    setUploadBannerError(null);
    stopCameraStream();

    let savedCount = 0;
    let failedCount = 0;
    let firstErrorMsg: string | null = null;

    const updatedAssets = [...assets];

    for (let i = 0; i < updatedAssets.length; i++) {
      const item = updatedAssets[i];
      if (item.uploadState === 'saved') {
        savedCount++;
        continue;
      }

      item.uploadState = 'uploading';
      setAssets([...updatedAssets]);
      setUploadProgressText(
        `Preserving original ${i + 1} of ${updatedAssets.length} (${item.viewLabel})…`
      );

      try {
        // eslint-disable-next-line no-await-in-loop
        await uploadSolopticsAsset(item, conditions, qualitySummary);
        savedCount++;
      } catch (err) {
        failedCount++;
        const msg = err instanceof Error ? err.message : String(err);
        if (!firstErrorMsg) firstErrorMsg = msg;
      }
      setAssets([...updatedAssets]);
    }

    await finalizeSolopticsSession(
      sessionId,
      selectedSampleId,
      sessionStartedAt,
      conditions,
      cameraCaps,
      updatedAssets
    );

    setIsUploading(false);
    setUploadProgressText('');

    window.dispatchEvent(new Event('consol:data-updated'));

    if (failedCount === 0) {
      toast(
        `SOLOPTICS session ${sessionId} preserved (${savedCount} original evidence file${savedCount === 1 ? '' : 's'}).`,
        'info'
      );
      setStage('completed');
    } else {
      setUploadBannerError(
        `${savedCount} saved, ${failedCount} failed (${firstErrorMsg}). Unsaved files remain in this session for safe retry.`
      );
      toast(`${failedCount} file(s) require retry. Unsaved evidence retained.`, 'error');
    }
  };

  // Start a fresh session for the active specimen
  const handleStartNewSession = () => {
    assets.forEach(a => {
      if (a.previewUrl && typeof URL !== 'undefined') URL.revokeObjectURL(a.previewUrl);
    });
    setAssets([]);
    setSelectedAssetId(null);
    setSessionId(`SOL-${Date.now().toString(36).toUpperCase().slice(-6)}`);
    setSessionStartedAt(new Date().toISOString());
    setUploadBannerError(null);
    setActivePass('pass_a_appearance');
    setActiveStepRole('front_surface');
    setStage('setup');
  };

  const selectedSpecimenRecord = useMemo(
    () => specimens.find(s => s.id === selectedSampleId) || null,
    [specimens, selectedSampleId]
  );

  const selectedAsset = useMemo(
    () => assets.find(a => a.id === selectedAssetId) || assets[assets.length - 1] || null,
    [assets, selectedAssetId]
  );

  const passACapturedCount = assets.filter(a => a.pass === 'pass_a_appearance').length;
  const passBCapturedCount = assets.filter(a => a.pass === 'pass_b_play_of_colour').length;

  return (
    <div className={`soloptics-instrument ${immersiveMode ? 'is-immersive' : ''}`}>
      {/* Hidden Native Camera & File Inputs for iOS Safari / Android Chrome */}
      <input
        ref={nativeCameraInputRef}
        type="file"
        accept={currentStepDef.allowsVideo ? 'video/*,image/*' : 'image/*'}
        capture="environment"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
        aria-hidden="true"
      />
      <input
        ref={filePickerInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
        aria-hidden="true"
      />

      {/* TOP INSTRUMENT BAR */}
      <header className="soloptics-topbar">
        <div className="soloptics-brand-row">
          <div className="soloptics-title-block">
            <span className="eyebrow">Visualisation · Optical Acquisition Instrument</span>
            <div className="soloptics-heading-inline">
              <h1>SOLOPTICS</h1>
              <span className="soloptics-session-code mono-cell">{sessionId}</span>
            </div>
          </div>

          <div className="soloptics-top-actions">
            <button
              type="button"
              className="secondary soloptics-nav-btn"
              onClick={() => setRailCollapsed(!railCollapsed)}
              title={railCollapsed ? 'Expand Navigation Rail' : 'Collapse to Instrument Rail'}
            >
              {railCollapsed ? 'Expand Rail' : 'Instrument Rail'}
            </button>
            <button
              type="button"
              className="secondary soloptics-nav-btn"
              onClick={() => setImmersiveMode(!immersiveMode)}
            >
              {immersiveMode ? 'Exit Full Screen' : 'Full Screen'}
            </button>
            {selectedSampleId && (
              <button
                type="button"
                className="secondary soloptics-nav-btn"
                onClick={() => {
                  stopCameraStream();
                  navigate(`#/solarium/${encodeURIComponent(selectedSampleId)}`);
                }}
              >
                ◈ Open SOLARIUM →
              </button>
            )}
          </div>
        </div>

        {/* WORKFLOW STEPPER PILLS */}
        <div className="soloptics-stage-tabs" role="tablist" aria-label="SOLOPTICS workflow stages">
          <button
            type="button"
            role="tab"
            aria-selected={stage === 'setup'}
            className={`soloptics-stage-tab ${stage === 'setup' ? 'active' : ''}`}
            onClick={() => {
              stopCameraStream();
              setStage('setup');
            }}
          >
            1. Specimen &amp; Conditions
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={stage === 'capture'}
            className={`soloptics-stage-tab ${stage === 'capture' ? 'active' : ''}`}
            disabled={!selectedSampleId}
            onClick={() => setStage('capture')}
          >
            2. Guided Capture ({assets.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={stage === 'review' || stage === 'completed'}
            className={`soloptics-stage-tab ${stage === 'review' || stage === 'completed' ? 'active' : ''}`}
            disabled={!selectedSampleId}
            onClick={() => {
              stopCameraStream();
              setStage(stage === 'completed' ? 'completed' : 'review');
            }}
          >
            3. Quality Review &amp; Save
          </button>
        </div>
      </header>

      {/* STAGE 1 — SPECIMEN SELECTION & ACQUISITION CONDITIONS (BUILD 1 & BUILD 4) */}
      {stage === 'setup' && (
        <div className="soloptics-setup-grid">
          {/* Left Column: Authoritative Specimen Binding */}
          <section className="surface pad soloptics-panel" aria-label="Specimen Selection">
            <div className="soloptics-section-head">
              <span className="eyebrow">Step 1 · Physical Specimen Identity</span>
              <h2>Bind Authoritative Specimen</h2>
              <p className="soloptics-sub">
                Every SOLOPTICS capture session must attach to a permanent database-assigned specimen record (AHM, ACC, ACX, OTH). No competing or orphaned IDs are created.
              </p>
            </div>

            {loadingSpecimens ? (
              <div className="loading" role="status">
                Checking CONSOL specimen registry…
              </div>
            ) : specimens.length === 0 ? (
              /* EMPTY SPECIMEN REGISTRY WORKFLOW (BUILD 1 REQUIREMENT) */
              <div className="soloptics-empty-registry" role="region" aria-label="Empty specimen registry">
                <h3>0 Registered Contemporary Specimens</h3>
                <p>
                  The physical specimen registry is currently empty. Register your specimen first to receive an authoritative database ID (e.g. <code>AHM-000001</code>), then return immediately to this SOLOPTICS acquisition session.
                </p>
                <div className="soloptics-empty-actions">
                  <button
                    type="button"
                    className="primary soloptics-cta-btn"
                    onClick={() => openModal('new-sample')}
                  >
                    ＋ Register Specimen Now
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => loadSpecimenRegistry()}
                  >
                    Refresh Registry ↻
                  </button>
                </div>
              </div>
            ) : (
              <div className="soloptics-specimen-selector">
                <label className="field">
                  <span>Selected Registered Specimen</span>
                  <select
                    value={selectedSampleId}
                    onChange={e => {
                      const nextId = e.target.value;
                      setSelectedSampleId(nextId);
                      if (nextId) setActiveSpecimenId(nextId);
                    }}
                  >
                    {specimens.map(sp => {
                      const t = SPECIMEN_TYPE_BY_CODE[sp.sample_code] || SPECIMEN_TYPES[3];
                      return (
                        <option key={sp.id} value={sp.id}>
                          {sp.id} — {t.short} · {sp.location || 'Andamooka'} ({sp.image_count || 0} media)
                        </option>
                      );
                    })}
                  </select>
                </label>

                {selectedSpecimenRecord && (
                  <div className="soloptics-specimen-summary">
                    <div className="soloptics-kv-row">
                      <span>Specimen ID</span>
                      <strong className="mono-cell">{selectedSpecimenRecord.id}</strong>
                    </div>
                    <div className="soloptics-kv-row">
                      <span>Classification</span>
                      <strong>
                        {selectedSpecimenRecord.sample_code} ·{' '}
                        {SPECIMEN_TYPE_BY_CODE[selectedSpecimenRecord.sample_code]?.name ||
                          selectedSpecimenRecord.sample_type}
                      </strong>
                    </div>
                    <div className="soloptics-kv-row">
                      <span>Provenance Location</span>
                      <strong>{selectedSpecimenRecord.location || 'Andamooka, SA'}</strong>
                    </div>
                    <div className="soloptics-kv-row">
                      <span>Existing Evidence</span>
                      <strong>
                        {selectedSpecimenRecord.image_count || 0} media files ·{' '}
                        {selectedSpecimenRecord.analysis_count || 0} pXRF readings
                      </strong>
                    </div>
                  </div>
                )}

                <div className="soloptics-inline-actions" style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => openModal('new-sample')}
                  >
                    ＋ Register Another Specimen
                  </button>
                  {selectedSampleId && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => navigate(`#/samples/${encodeURIComponent(selectedSampleId)}`)}
                    >
                      Inspect Specimen Record →
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Prior SOLOPTICS sessions on this specimen */}
            {priorSessions.length > 0 && (
              <div className="soloptics-prior-sessions" style={{ marginTop: 22 }}>
                <span className="eyebrow">
                  Recorded SOLOPTICS Sessions for {selectedSampleId} ({priorSessions.length})
                </span>
                <div className="soloptics-prior-list">
                  {priorSessions.slice(0, 4).map(ps => (
                    <div key={ps.sessionId} className="soloptics-prior-item">
                      <div>
                        <strong className="mono-cell">{ps.sessionId}</strong>
                        <small>
                          {new Date(ps.capturedAt).toLocaleString('en-AU')} · Pass A:{' '}
                          {ps.passAAssets.length} · Pass B: {ps.passBAssets.length}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="consol-row-btn"
                        onClick={() => navigate(`#/solarium/${encodeURIComponent(selectedSampleId)}`)}
                      >
                        Inspect in SOLARIUM →
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Right Column: Acquisition Conditions & Optical Setup (BUILD 4) */}
          <section className="surface pad soloptics-panel" aria-label="Acquisition Conditions">
            <div className="soloptics-section-head">
              <span className="eyebrow">Step 2 · Acquisition Conditions &amp; Calibration Scope</span>
              <h2>Optical Setup Metadata</h2>
              <p className="soloptics-sub">
                Record illumination geometry, background stage, and physical references before beginning Pass A and Pass B.
              </p>
            </div>

            <div className="soloptics-form-grid">
              <label className="field">
                <span>Illumination Source Type</span>
                <select
                  value={conditions.illuminationType}
                  onChange={e =>
                    setConditions(prev => ({
                      ...prev,
                      illuminationType: e.target.value as IlluminationSourceType
                    }))
                  }
                >
                  {(Object.keys(ILLUMINATION_TYPE_LABELS) as IlluminationSourceType[]).map(k => (
                    <option key={k} value={k}>
                      {ILLUMINATION_TYPE_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Primary Lamp Position / Incidence</span>
                <select
                  value={conditions.illuminationDirection}
                  onChange={e =>
                    setConditions(prev => ({
                      ...prev,
                      illuminationDirection: e.target.value as IlluminationDirectionPreset
                    }))
                  }
                >
                  {(Object.keys(ILLUMINATION_DIRECTION_LABELS) as IlluminationDirectionPreset[]).map(
                    k => (
                      <option key={k} value={k}>
                        {ILLUMINATION_DIRECTION_LABELS[k]}
                      </option>
                    )
                  )}
                </select>
              </label>

              <label className="field">
                <span>Background Stage Surface</span>
                <select
                  value={conditions.backgroundSurface}
                  onChange={e =>
                    setConditions(prev => ({
                      ...prev,
                      backgroundSurface: e.target.value as BackgroundSurfaceType
                    }))
                  }
                >
                  {(Object.keys(BACKGROUND_SURFACE_LABELS) as BackgroundSurfaceType[]).map(k => (
                    <option key={k} value={k}>
                      {BACKGROUND_SURFACE_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Approximate Lamp Distance (cm)</span>
                <input
                  type="number"
                  min="2"
                  max="200"
                  value={conditions.illuminationDistanceCm}
                  onChange={e =>
                    setConditions(prev => ({ ...prev, illuminationDistanceCm: e.target.value }))
                  }
                />
              </label>
            </div>

            {/* Scale & Colour Reference Toggles */}
            <div className="soloptics-ref-checks">
              <label className="soloptics-check-row">
                <input
                  type="checkbox"
                  checked={conditions.scaleReferencePresent}
                  onChange={e =>
                    setConditions(prev => ({
                      ...prev,
                      scaleReferencePresent: e.target.checked
                    }))
                  }
                />
                <div>
                  <strong>Physical Millimetre Scale Bar Present in Frame</strong>
                  <small>
                    Required if dimensional measurements will be calibrated from Pass A frames.
                  </small>
                </div>
              </label>

              {conditions.scaleReferencePresent && (
                <label className="field" style={{ marginTop: 8 }}>
                  <span>Reference Scale Length (mm)</span>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    step="0.5"
                    value={conditions.scaleReferenceMm}
                    onChange={e =>
                      setConditions(prev => ({ ...prev, scaleReferenceMm: e.target.value }))
                    }
                  />
                </label>
              )}

              <label className="soloptics-check-row" style={{ marginTop: 10 }}>
                <input
                  type="checkbox"
                  checked={conditions.colourReferencePresent}
                  onChange={e =>
                    setConditions(prev => ({
                      ...prev,
                      colourReferencePresent: e.target.checked
                    }))
                  }
                />
                <div>
                  <strong>Neutral Colour / Grey Reference Target Present</strong>
                  <small>
                    Documents white-balance state under mobile auto-exposure / AWB limitations.
                  </small>
                </div>
              </label>
            </div>

            <label className="field" style={{ marginTop: 12 }}>
              <span>Session Optical &amp; Environmental Notes</span>
              <input
                type="text"
                placeholder="e.g. Dry specimen surface, iPhone 16 Pro macro lens, dark room"
                value={conditions.sessionNotes}
                onChange={e =>
                  setConditions(prev => ({ ...prev, sessionNotes: e.target.value }))
                }
              />
            </label>

            <div className="scientific-note" style={{ marginTop: 14 }}>
              <span className="eyebrow">Scientific Qualification</span>
              <p>
                Smartphone RGB capture documents physical appearance and directional play-of-colour behaviour. Auto-exposure, auto-white-balance, and uncalibrated hand motion are explicitly recorded in session metadata.
              </p>
            </div>

            <div className="soloptics-setup-cta" style={{ marginTop: 18 }}>
              <button
                type="button"
                className="primary soloptics-cta-btn"
                disabled={!selectedSampleId}
                onClick={() => {
                  setStage('capture');
                  startCameraStream();
                }}
              >
                Begin Guided Optical Capture ({selectedSampleId || 'Select Specimen'}) →
              </button>
            </div>
          </section>
        </div>
      )}

      {/* STAGE 2 — FULL-SCREEN MOBILE-FIRST GUIDED CAPTURE CHAMBER (BUILD 1, BUILD 2, BUILD 3) */}
      {stage === 'capture' && (
        <div className="soloptics-capture-workspace">
          {/* Pass Selector Bar: Pass A (Physical Appearance) vs Pass B (Play-of-Colour) */}
          <div className="soloptics-pass-switcher" role="tablist" aria-label="Acquisition Pass">
            <button
              type="button"
              role="tab"
              aria-selected={activePass === 'pass_a_appearance'}
              className={`soloptics-pass-tab ${activePass === 'pass_a_appearance' ? 'active' : ''}`}
              onClick={() => handleSwitchPass('pass_a_appearance')}
            >
              <div>
                <strong>Pass A · Physical Appearance</strong>
                <small>Front, Reverse, Profile &amp; Scale ({passACapturedCount} captured)</small>
              </div>
              <span className={`soloptics-pass-status ${qualitySummary.passAComplete ? 'ok' : ''}`}>
                {qualitySummary.passAComplete ? 'Ready ✓' : `${passACapturedCount}/3 req`}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activePass === 'pass_b_play_of_colour'}
              className={`soloptics-pass-tab ${activePass === 'pass_b_play_of_colour' ? 'active' : ''}`}
              onClick={() => handleSwitchPass('pass_b_play_of_colour')}
            >
              <div>
                <strong>Pass B · Play-of-Colour</strong>
                <small>Fixed Directional Light · Multi-View Sequence ({passBCapturedCount} captured)</small>
              </div>
              <span className={`soloptics-pass-status ${qualitySummary.passBComplete ? 'ok' : ''}`}>
                {qualitySummary.passBComplete ? 'Ready ✓' : `${passBCapturedCount}/3 req`}
              </span>
            </button>
          </div>

          {/* Step Sequence Pill Strip */}
          <div className="soloptics-step-strip" role="group" aria-label="Guided capture steps">
            {stepsForActivePass.map(step => {
              const countForRole = assets.filter(a => a.stepRole === step.role).length;
              const isCurrent = activeStepRole === step.role;
              return (
                <button
                  key={step.role}
                  type="button"
                  className={`soloptics-step-pill ${isCurrent ? 'is-current' : ''} ${
                    countForRole > 0 ? 'is-captured' : ''
                  }`}
                  onClick={() => setActiveStepRole(step.role)}
                >
                  <span>{step.shortLabel}</span>
                  {countForRole > 0 && <b className="mono-cell">✓{countForRole}</b>}
                </button>
              );
            })}
          </div>

          {/* Main Capture Chamber Grid */}
          <div className="soloptics-chamber-grid">
            {/* Viewfinder Stage */}
            <div className="soloptics-viewfinder-stage">
              {/* Top Overlay: Active Specimen & Current Step Guidance */}
              <div className="soloptics-viewfinder-hud-top">
                <div className="soloptics-hud-badge">
                  <strong className="mono-cell">{selectedSampleId}</strong>
                  <span>·</span>
                  <span>{currentStepDef.label}</span>
                  {currentStepDef.required ? (
                    <span className="soloptics-req-tag">Required</span>
                  ) : (
                    <span className="soloptics-opt-tag">Optional</span>
                  )}
                </div>
                <p className="soloptics-hud-guidance">{currentStepDef.guidance}</p>
              </div>

              {/* Video Viewfinder or Fallback Prompt */}
              <div className="soloptics-viewport-box">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className={`soloptics-live-video ${isCameraLive ? 'is-active' : ''}`}
                />

                {/* Optical Framing Reticle Overlay */}
                <div className="soloptics-reticle-overlay" aria-hidden="true">
                  <div className="soloptics-reticle-ring" />
                  <div className="soloptics-reticle-crosshair-h" />
                  <div className="soloptics-reticle-crosshair-v" />
                </div>

                {!isCameraLive && (
                  <div className="soloptics-viewfinder-placeholder">
                    <p>
                      {cameraError ||
                        'Start the live rear camera viewfinder or launch the native iPhone / Android camera shutter below.'}
                    </p>
                    <div className="soloptics-placeholder-btns">
                      <button
                        type="button"
                        className="primary soloptics-cta-btn"
                        onClick={startCameraStream}
                      >
                        Enable Live Viewfinder
                      </button>
                      <button
                        type="button"
                        className="secondary soloptics-cta-btn"
                        onClick={() => nativeCameraInputRef.current?.click()}
                      >
                        Open Native Camera Shutter
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Touch-Optimised Bottom Shutter Controls (>= 48px targets) */}
              <div className="soloptics-shutter-bar">
                <button
                  type="button"
                  className="secondary soloptics-tool-btn"
                  onClick={() => filePickerInputRef.current?.click()}
                  title="Import existing frame from device photos/files"
                >
                  ＋ Library / Files
                </button>

                {isCameraLive ? (
                  currentStepDef.allowsVideo ? (
                    !isRecordingVideo ? (
                      <button
                        type="button"
                        className="primary soloptics-shutter-primary is-video"
                        onClick={handleStartVideoSweep}
                      >
                        ● Record Play-of-Colour Sweep
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="primary soloptics-shutter-primary is-recording"
                        onClick={handleStopVideoSweep}
                      >
                        ■ Stop Sweep ({recordingSeconds}s)
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      className="primary soloptics-shutter-primary"
                      onClick={handleCaptureLiveStill}
                    >
                      ◎ Capture {currentStepDef.shortLabel}
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    className="primary soloptics-shutter-primary"
                    onClick={() => nativeCameraInputRef.current?.click()}
                  >
                    ◎ Capture {currentStepDef.shortLabel} (Camera)
                  </button>
                )}

                {isCameraLive && cameraCaps.torchSupported ? (
                  <button
                    type="button"
                    className={`secondary soloptics-tool-btn ${torchActive ? 'active' : ''}`}
                    onClick={handleToggleTorch}
                  >
                    {torchActive ? 'Torch On' : 'Torch Off'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="secondary soloptics-tool-btn"
                    onClick={() => {
                      stopCameraStream();
                      setStage('review');
                    }}
                  >
                    Review ({assets.length}) →
                  </button>
                )}
              </div>
            </div>

            {/* Side / Bottom Live Evidence Tray & Instant Quality Feedback */}
            <aside className="surface pad soloptics-capture-sidebar" aria-label="Captured Frames & Quality">
              <div className="soloptics-sidebar-head">
                <div>
                  <span className="eyebrow">Session Evidence Tray</span>
                  <h3>{assets.length} Frame{assets.length === 1 ? '' : 's'} Captured</h3>
                </div>
                <button
                  type="button"
                  className="primary"
                  disabled={assets.length === 0}
                  onClick={() => {
                    stopCameraStream();
                    setStage('review');
                  }}
                >
                  Review &amp; Save →
                </button>
              </div>

              {/* Latest Frame Quality Telemetry Card (BUILD 3) */}
              {selectedAsset ? (
                <div className="soloptics-latest-quality-card">
                  <div className="soloptics-latest-preview">
                    {selectedAsset.isVideo ? (
                      <video src={selectedAsset.previewUrl} controls playsInline />
                    ) : (
                      <img src={selectedAsset.previewUrl} alt={selectedAsset.viewLabel} />
                    )}
                  </div>
                  <div className="soloptics-latest-meta">
                    <div className="soloptics-latest-title">
                      <strong>{selectedAsset.viewLabel}</strong>
                      <span
                        className={`soloptics-q-flag ${
                          selectedAsset.quality.status === 'pass' ? 'pass' : 'warn'
                        }`}
                      >
                        {selectedAsset.quality.status === 'pass'
                          ? 'Quality Pass'
                          : 'Advisory Flagged'}
                      </span>
                    </div>
                    <div className="soloptics-telemetry-row mono-cell">
                      <span>
                        {selectedAsset.quality.widthPx
                          ? `${selectedAsset.quality.widthPx}×${selectedAsset.quality.heightPx}px`
                          : 'Video clip'}
                      </span>
                      <span>·</span>
                      <span>Sharpness {selectedAsset.quality.sharpnessScore}</span>
                      <span>·</span>
                      <span>Clip {selectedAsset.quality.overexposedPct}%</span>
                    </div>
                    {selectedAsset.quality.warnings.length > 0 && (
                      <ul className="soloptics-warn-list">
                        {selectedAsset.quality.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    )}
                    <div className="soloptics-frame-actions">
                      <button
                        type="button"
                        className="consol-row-btn"
                        onClick={() => handleRetakeAsset(selectedAsset)}
                      >
                        ↺ Retake Step
                      </button>
                      <button
                        type="button"
                        className="consol-row-btn"
                        onClick={() => handleRemoveAsset(selectedAsset.id)}
                      >
                        Discard ✕
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="soloptics-empty-tray">
                  No frames captured in this session yet. Follow the Pass A and Pass B prompts to collect reproducible optical evidence.
                </div>
              )}

              {/* Thumbnail Strip of All Session Captures */}
              {assets.length > 0 && (
                <div className="soloptics-thumb-strip">
                  {assets.map(a => (
                    <button
                      key={a.id}
                      type="button"
                      className={`soloptics-thumb-item ${
                        selectedAsset?.id === a.id ? 'is-selected' : ''
                      } ${a.quality.status === 'warning' ? 'has-warning' : ''}`}
                      onClick={() => setSelectedAssetId(a.id)}
                    >
                      {a.isVideo ? (
                        <div className="soloptics-video-badge">VIDEO</div>
                      ) : (
                        <img src={a.previewUrl} alt={a.viewLabel} />
                      )}
                      <span>{a.viewLabel.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Camera Hardware & Exposure Limitation Disclosure (BUILD 2 & BUILD 4) */}
              <div className="soloptics-limitations-box">
                <span className="eyebrow">Recorded Acquisition Limitations</span>
                <ul>
                  {cameraCaps.limitations.slice(0, 2).map((lim, idx) => (
                    <li key={idx}>{lim}</li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </div>
      )}

      {/* STAGE 3 — QUALITY REVIEW, PROVENANCE VERIFICATION & RESILIENT UPLOAD (BUILD 3, 4, 5, 6) */}
      {(stage === 'review' || stage === 'completed') && (
        <div className="soloptics-review-workspace">
          {stage === 'completed' && (
            <section
              className="surface pad soloptics-completed-banner"
              role="status"
              aria-label="Capture Session Saved"
            >
              <div>
                <span className="eyebrow">Session Committed to Supabase Storage &amp; Evidence Ledger</span>
                <h2>
                  SOLOPTICS Session {sessionId} Saved for {selectedSampleId}
                </h2>
                <p>
                  All {assets.length} original evidence files, SHA-256 digests, illumination parameters, and quality evaluations are now linked to authoritative specimen <strong>{selectedSampleId}</strong>.
                </p>
              </div>
              <div className="soloptics-completed-actions">
                <button
                  type="button"
                  className="primary soloptics-cta-btn"
                  onClick={() => navigate(`#/solarium/${encodeURIComponent(selectedSampleId)}`)}
                >
                  ◈ Inspect in SOLARIUM Light Box →
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => navigate(`#/samples/${encodeURIComponent(selectedSampleId)}`)}
                >
                  Open Specimen Record →
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={handleStartNewSession}
                >
                  ＋ New Capture Session
                </button>
              </div>
            </section>
          )}

          {uploadBannerError && (
            <div className="soloptics-error-banner" role="alert">
              <strong>Partial Upload Recovery Active:</strong> {uploadBannerError}
            </div>
          )}

          <div className="soloptics-review-grid">
            {/* Left: Quality Completeness & Metadata Audit */}
            <section className="surface pad soloptics-panel" aria-label="Session Quality Audit">
              <div className="soloptics-section-head">
                <span className="eyebrow">Capture Quality &amp; Provenance Summary</span>
                <h2>
                  {selectedSampleId} · Session {sessionId}
                </h2>
              </div>

              <div className="soloptics-quality-metrics">
                <div className="soloptics-q-cell">
                  <span>Pass A (Appearance)</span>
                  <strong className={qualitySummary.passAComplete ? 'text-ok' : 'text-warn'}>
                    {qualitySummary.passAComplete
                      ? `Complete (${qualitySummary.passACount} frames)`
                      : `Partial (${qualitySummary.passACount} frames)`}
                  </strong>
                </div>
                <div className="soloptics-q-cell">
                  <span>Pass B (Play-of-Colour)</span>
                  <strong className={qualitySummary.passBComplete ? 'text-ok' : 'text-warn'}>
                    {qualitySummary.passBComplete
                      ? `Complete (${qualitySummary.passBStillCount} views, ${qualitySummary.passBVideoCount} video)`
                      : `Partial (${qualitySummary.passBStillCount} views)`}
                  </strong>
                </div>
                <div className="soloptics-q-cell">
                  <span>Scale Reference</span>
                  <strong>
                    {qualitySummary.scaleReferenceRecorded
                      ? `${conditions.scaleReferenceMm || 10} mm recorded`
                      : 'Not included (Uncalibrated)'}
                  </strong>
                </div>
                <div className="soloptics-q-cell">
                  <span>Colour Reference</span>
                  <strong>
                    {qualitySummary.colourReferenceRecorded
                      ? 'Included in session'
                      : 'Not included (Device AWB)'}
                  </strong>
                </div>
              </div>

              {qualitySummary.advisories.length > 0 && (
                <div className="soloptics-advisories-box" style={{ marginTop: 14 }}>
                  <span className="eyebrow">Quality Advisories (Non-Blocking)</span>
                  <ul>
                    {qualitySummary.advisories.map((adv, idx) => (
                      <li key={idx}>{adv}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="soloptics-specimen-summary" style={{ marginTop: 16 }}>
                <div className="soloptics-kv-row">
                  <span>Operator</span>
                  <strong>{conditions.operatorEmail}</strong>
                </div>
                <div className="soloptics-kv-row">
                  <span>Illumination</span>
                  <strong>
                    {ILLUMINATION_TYPE_LABELS[conditions.illuminationType]} ·{' '}
                    {ILLUMINATION_DIRECTION_LABELS[conditions.illuminationDirection]}
                  </strong>
                </div>
                <div className="soloptics-kv-row">
                  <span>Background Surface</span>
                  <strong>{BACKGROUND_SURFACE_LABELS[conditions.backgroundSurface]}</strong>
                </div>
                <div className="soloptics-kv-row">
                  <span>Exposure / WB Mode</span>
                  <strong className="mono-cell">
                    {cameraCaps.exposureMode || 'auto'} / {cameraCaps.whiteBalanceMode || 'auto'}
                  </strong>
                </div>
              </div>

              {stage !== 'completed' && (
                <div className="soloptics-commit-bar" style={{ marginTop: 20 }}>
                  <button
                    type="button"
                    className="primary soloptics-cta-btn"
                    disabled={isUploading || assets.length === 0}
                    onClick={handleCommitSession}
                  >
                    {isUploading
                      ? uploadProgressText || 'Preserving Originals…'
                      : uploadBannerError
                        ? 'Retry Unsaved Evidence Uploads →'
                        : `Preserve ${assets.length} Original Evidence File${assets.length === 1 ? '' : 's'} to CONSOL →`}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={isUploading}
                    onClick={() => setStage('capture')}
                  >
                    ← Back to Capture Chamber
                  </button>
                </div>
              )}
            </section>

            {/* Right: Individual Evidence Asset Inspection List */}
            <section className="surface pad soloptics-panel" aria-label="Captured Evidence Files">
              <div className="soloptics-section-head">
                <span className="eyebrow">Original Evidence Manifest</span>
                <h2>Captured Frames ({assets.length})</h2>
              </div>

              {assets.length === 0 ? (
                <div className="soloptics-empty-tray">
                  No frames captured yet. Return to the Capture Chamber to record Pass A or Pass B views.
                </div>
              ) : (
                <div className="soloptics-review-asset-list">
                  {assets.map(item => (
                    <article key={item.id} className="soloptics-review-asset-item">
                      <div className="soloptics-review-thumb">
                        {item.isVideo ? (
                          <video src={item.previewUrl} preload="metadata" />
                        ) : (
                          <img src={item.previewUrl} alt={item.viewLabel} />
                        )}
                      </div>
                      <div className="soloptics-review-item-body">
                        <div className="soloptics-review-item-top">
                          <strong>{item.viewLabel}</strong>
                          <span className={`soloptics-upload-pill is-${item.uploadState}`}>
                            {item.uploadState === 'saved'
                              ? 'Saved ✓'
                              : item.uploadState === 'uploading'
                                ? 'Uploading…'
                                : item.uploadState === 'retryable' || item.uploadState === 'failed'
                                  ? 'Retryable'
                                  : 'Pending'}
                          </span>
                        </div>
                        <div className="consol-quiet-meta mono-cell">
                          <span>
                            {item.pass === 'pass_a_appearance'
                              ? 'Pass A · Appearance'
                              : 'Pass B · Play-of-Colour'}
                          </span>
                          <span>·</span>
                          <span>
                            {item.quality.widthPx
                              ? `${item.quality.widthPx}×${item.quality.heightPx}px`
                              : 'Video'}
                          </span>
                          <span>·</span>
                          <span>{(item.sizeBytes / 1024).toFixed(0)} KB</span>
                          {item.sha256 && (
                            <>
                              <span>·</span>
                              <span>SHA-256 {item.sha256.slice(0, 10)}…</span>
                            </>
                          )}
                        </div>
                        {item.quality.warnings.length > 0 && (
                          <small className="soloptics-item-warning">
                            Advisory: {item.quality.warnings.join(' ')}
                          </small>
                        )}
                        {item.uploadError && (
                          <small className="soloptics-item-error">{item.uploadError}</small>
                        )}
                      </div>
                      {item.uploadState !== 'saved' && !isUploading && (
                        <div className="soloptics-review-item-actions">
                          <button
                            type="button"
                            className="consol-row-btn"
                            onClick={() => handleRetakeAsset(item)}
                          >
                            Retake
                          </button>
                          <button
                            type="button"
                            className="consol-row-btn"
                            onClick={() => handleRemoveAsset(item.id)}
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
};

export default SolopticsView;
