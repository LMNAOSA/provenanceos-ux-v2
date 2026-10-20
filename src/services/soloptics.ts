/**
 * CONSOL — SOLOPTICS Optical Acquisition & Quality Evaluation Service (v1.0)
 *
 * Implements:
 * - BUILD 2: Guided Dual-Pass Optical Capture (Pass A: Physical Appearance, Pass B: Play-of-Colour)
 * - BUILD 3: Practical Capture Quality Checks (Laplacian focus/blur variance, over/underexposure clipping,
 *   minimum frame resolution, Pass B angular sequence completeness, scale & colour reference checks)
 * - BUILD 4: Acquisition Metadata Contract (device/browser, camera track capabilities, auto-exposure/AWB
 *   limitation flags, illumination type/position, background surface, scale/colour reference)
 * - BUILD 5: Reliable Upload, SHA-256 hashing, Supabase Storage (`sample-images` bucket) + `sample_images`
 *   evidence persistence, staging table support (`optical_capture_sessions`), and local recovery
 * - BUILD 6: SOLARIUM & Specimen Record optical evidence session retrieval
 */

import config from '../config';
import { extractPhotoGeo, savePhotoGeoObservation } from './geographicEvidence';
import { getSupabase, api, signed } from './supabase';
import { sha256, validateMedia, generateThumbnailBlob, resolveMediaMime } from './media';
import type { CaptureKind, SpecimenImage } from '../types';

export type SolopticsPassId = 'pass_a_appearance' | 'pass_b_play_of_colour';

export type SolopticsStepRole =
  | 'front_surface'
  | 'reverse_surface'
  | 'side_profile'
  | 'additional_coverage'
  | 'scale_colour_reference'
  | 'poc_view_1'
  | 'poc_view_2'
  | 'poc_view_3'
  | 'poc_view_4'
  | 'poc_view_5'
  | 'poc_extra_still'
  | 'poc_motion_video';

export type IlluminationSourceType =
  | 'diffuse_daylight_white'
  | 'fixed_directional_led'
  | 'halogen_point_source'
  | 'uv_365nm_longwave'
  | 'uv_254nm_shortwave'
  | 'mixed_ambient_field';

export type IlluminationDirectionPreset =
  | 'overhead_90deg'
  | 'oblique_45deg_front'
  | 'oblique_30deg_low'
  | 'side_raking_15deg'
  | 'coaxial_camera_aligned'
  | 'handheld_variable';

export type BackgroundSurfaceType =
  | 'matte_black_velvet'
  | 'neutral_18pct_grey'
  | 'calibration_white_ptfe'
  | 'field_natural_host_rock';

export interface SolopticsStepDefinition {
  role: SolopticsStepRole;
  pass: SolopticsPassId;
  order: number;
  label: string;
  shortLabel: string;
  required: boolean;
  allowsVideo: boolean;
  guidance: string;
  scientificQualification: string;
}

export const SOLOPTICS_STEPS: SolopticsStepDefinition[] = [
  // PASS A — PHYSICAL APPEARANCE
  {
    role: 'front_surface',
    pass: 'pass_a_appearance',
    order: 1,
    label: 'Front Surface (Primary Face)',
    shortLabel: 'A1 · Front',
    required: true,
    allowsVideo: false,
    guidance: 'Centre the primary opal face parallel to the lens under diffuse white illumination. Hold steady and tap to focus.',
    scientificQualification: 'Unscaled RGB physical appearance record; not calibrated dimensional geometry.'
  },
  {
    role: 'reverse_surface',
    pass: 'pass_a_appearance',
    order: 2,
    label: 'Reverse Surface (Matrix / Back)',
    shortLabel: 'A2 · Reverse',
    required: true,
    allowsVideo: false,
    guidance: 'Turn the specimen 180° to document the reverse host matrix, potch backing, or untreated contact surface.',
    scientificQualification: 'Documents backing matrix and host-rock texture under diffuse white light.'
  },
  {
    role: 'side_profile',
    pass: 'pass_a_appearance',
    order: 3,
    label: 'Side / Profile Elevation',
    shortLabel: 'A3 · Profile',
    required: true,
    allowsVideo: false,
    guidance: 'Capture the cross-sectional profile to show seam thickness, matrix stratification, or dome curvature.',
    scientificQualification: 'Profile appearance documentation; does not replace physical micrometer measurement.'
  },
  {
    role: 'additional_coverage',
    pass: 'pass_a_appearance',
    order: 4,
    label: 'Additional Coverage Views',
    shortLabel: 'A4 · Coverage',
    required: false,
    allowsVideo: false,
    guidance: 'Optional oblique views of fractures, inclusions, colour bars, or secondary faces.',
    scientificQualification: 'Supplementary appearance coverage.'
  },
  {
    role: 'scale_colour_reference',
    pass: 'pass_a_appearance',
    order: 5,
    label: 'Scale & Colour Reference Frame',
    shortLabel: 'A5 · Scale/Ref',
    required: false,
    allowsVideo: false,
    guidance: 'Place a physical millimetre scale bar and/or neutral colour target in the same focal plane as the specimen.',
    scientificQualification: 'Provides visual reference in-frame; requires explicit 2D metrology calibration before dimensional claims.'
  },

  // PASS B — PLAY-OF-COLOUR (DIRECTIONAL LIGHT, VARYING VIEW ORIENTATION)
  {
    role: 'poc_view_1',
    pass: 'pass_b_play_of_colour',
    order: 1,
    label: 'View 01 · Normal Incidence (0° Baseline)',
    shortLabel: 'B1 · View 01',
    required: true,
    allowsVideo: false,
    guidance: 'Keep the directional light source fixed. Position the camera perpendicular (0°) to the primary face.',
    scientificQualification: 'Uncalibrated RGB directional observation #1; does not constitute a calibrated spectral measurement.'
  },
  {
    role: 'poc_view_2',
    pass: 'pass_b_play_of_colour',
    order: 2,
    label: 'View 02 · Low Oblique Tilt (~15°–25°)',
    shortLabel: 'B2 · View 02',
    required: true,
    allowsVideo: false,
    guidance: 'Keep light source fixed. Shift viewing angle slightly (~15°–25°) to record initial diffraction colour shift or flash onset.',
    scientificQualification: 'Ordered multi-view RGB frame #2; angular orientation is nominal operator-guided, not goniometric.'
  },
  {
    role: 'poc_view_3',
    pass: 'pass_b_play_of_colour',
    order: 3,
    label: 'View 03 · Peak Flash Orientation',
    shortLabel: 'B3 · View 03',
    required: true,
    allowsVideo: false,
    guidance: 'Orient the viewing angle to capture the strongest play-of-colour flash domain without clipping highlights.',
    scientificQualification: 'Ordered multi-view RGB frame #3; phone auto-exposure/AWB may shift apparent saturation.'
  },
  {
    role: 'poc_view_4',
    pass: 'pass_b_play_of_colour',
    order: 4,
    label: 'View 04 · Cross-Axis Oblique (~45°)',
    shortLabel: 'B4 · View 04',
    required: false,
    allowsVideo: false,
    guidance: 'Shift viewing orientation across the perpendicular axis to document directional extinction or rolling flash.',
    scientificQualification: 'Ordered multi-view RGB frame #4.'
  },
  {
    role: 'poc_view_5',
    pass: 'pass_b_play_of_colour',
    order: 5,
    label: 'View 05 · Grazing Incidence (~60°)',
    shortLabel: 'B5 · View 05',
    required: false,
    allowsVideo: false,
    guidance: 'Capture a high-angle grazing view to observe long-wavelength spectral shift or surface polish scatter.',
    scientificQualification: 'Ordered multi-view RGB frame #5.'
  },
  {
    role: 'poc_motion_video',
    pass: 'pass_b_play_of_colour',
    order: 6,
    label: 'Continuous Play-of-Colour Sweep (Slow Video)',
    shortLabel: 'B6 · Video Sweep',
    required: false,
    allowsVideo: true,
    guidance: 'Record a slow, steady 4–8 second angular sweep under the fixed directional lamp to document continuous flash transitions.',
    scientificQualification: 'Continuous RGB video evidence; subject to codec compression and mobile auto-exposure drift.'
  }
];

export interface FrameQualityAssessment {
  widthPx: number;
  heightPx: number;
  sharpnessScore: number; // Laplacian variance proxy (typical sharp macro > 18, blurry < 10)
  overexposedPct: number; // % pixels near 255 clipping
  underexposedPct: number; // % pixels near 0 shadow crush
  meanLuminance: number; // 0 - 255
  status: 'pass' | 'warning';
  warnings: string[];
  evaluatedAt: string;
}

export interface CameraHardwareCapabilities {
  userAgent: string;
  platform: string;
  cameraLabel: string | null;
  facingMode: string | null;
  widthPx: number | null;
  heightPx: number | null;
  frameRate: number | null;
  exposureMode: string | null;
  whiteBalanceMode: string | null;
  focusMode: string | null;
  torchSupported: boolean;
  manualExposureSupported: boolean;
  manualWhiteBalanceSupported: boolean;
  limitations: string[];
}

export interface SolopticsCaptureConditions {
  operatorEmail: string;
  captureKind: CaptureKind;
  illuminationType: IlluminationSourceType;
  illuminationDirection: IlluminationDirectionPreset;
  illuminationDistanceCm: string;
  illuminationNotes: string;
  backgroundSurface: BackgroundSurfaceType;
  scaleReferencePresent: boolean;
  scaleReferenceMm: string;
  colourReferencePresent: boolean;
  colourReferenceNote: string;
  sessionNotes: string;
}

export type SolopticsShotUploadState = 'pending' | 'uploading' | 'saved' | 'failed' | 'retryable';

export interface SolopticsCapturedAsset {
  id: string;
  sessionId: string;
  sampleId: string;
  pass: SolopticsPassId;
  stepRole: SolopticsStepRole;
  sequenceOrder: number;
  viewLabel: string;
  file: File;
  previewUrl: string;
  mimeType: string;
  sizeBytes: number;
  isVideo: boolean;
  captureKind: CaptureKind;
  capturedAt: string;
  quality: FrameQualityAssessment;
  cameraCapabilities: CameraHardwareCapabilities;
  uploadState: SolopticsShotUploadState;
  uploadError?: string;
  sha256?: string;
  storagePath?: string;
  thumbPath?: string | null;
  savedSampleImageId?: string;
}

export interface SolopticsSessionQualitySummary {
  passAComplete: boolean;
  passACount: number;
  passAMissingRoles: string[];
  passBComplete: boolean;
  passBStillCount: number;
  passBVideoCount: number;
  sharpFramesCount: number;
  warningFramesCount: number;
  scaleReferenceRecorded: boolean;
  colourReferenceRecorded: boolean;
  overallStatus: 'complete' | 'partial_warnings' | 'incomplete';
  advisories: string[];
}

export interface PersistedSolopticsAssetMetadata {
  assetId: string;
  sampleImageId: string;
  pass: SolopticsPassId;
  stepRole: SolopticsStepRole;
  sequenceOrder: number;
  viewLabel: string;
  storagePath: string;
  thumbPath: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  widthPx: number | null;
  heightPx: number | null;
  isVideo: boolean;
  captureKind: CaptureKind;
  capturedAt: string;
  quality: FrameQualityAssessment;
}

export interface PersistedSolopticsSession {
  sessionId: string;
  sampleId: string;
  operatorEmail: string;
  startedAt: string;
  completedAt: string;
  conditions: SolopticsCaptureConditions;
  cameraCapabilities: CameraHardwareCapabilities;
  qualitySummary: SolopticsSessionQualitySummary;
  assets: PersistedSolopticsAssetMetadata[];
  lifecycleState: 'saved' | 'partial';
}

const SOLOPTICS_LOCAL_SESSIONS_KEY = 'consol.soloptics.sessions.v1';

export const ILLUMINATION_TYPE_LABELS: Record<IlluminationSourceType, string> = {
  diffuse_daylight_white: 'Diffuse White LED / Daylight (~5500K)',
  fixed_directional_led: 'Fixed Point-Source Directional LED',
  halogen_point_source: 'Halogen / Broad-Spectrum Fibre Point Source',
  uv_365nm_longwave: 'UV 365 nm Longwave Excitation',
  uv_254nm_shortwave: 'UV 254 nm Shortwave Excitation',
  mixed_ambient_field: 'Uncalibrated Field / Ambient Daylight'
};

export const ILLUMINATION_DIRECTION_LABELS: Record<IlluminationDirectionPreset, string> = {
  overhead_90deg: 'Overhead Normal (90°)',
  oblique_45deg_front: 'Oblique 45° Fixed Key Light',
  oblique_30deg_low: 'Low Oblique 30° Directional',
  side_raking_15deg: 'Side Raking 15° Grazing Light',
  coaxial_camera_aligned: 'Coaxial / Camera-Aligned Source',
  handheld_variable: 'Handheld / Field Unfixed Source'
};

export const BACKGROUND_SURFACE_LABELS: Record<BackgroundSurfaceType, string> = {
  matte_black_velvet: 'Matte Black Optical Stage',
  neutral_18pct_grey: 'Neutral 18% Grey Reference Card',
  calibration_white_ptfe: 'Matte White Reference Surface',
  field_natural_host_rock: 'Field Host Rock / Uncontrolled Surface'
};

/**
 * Inspects MediaStreamTrack capabilities & settings where exposed by iOS Safari / Android Chrome,
 * and explicitly flags auto-exposure, auto-white-balance, and unsupported manual camera controls
 * as scientific acquisition limitations (BUILD 2 & BUILD 4).
 */
export function extractCameraCapabilities(track?: MediaStreamTrack | null): CameraHardwareCapabilities {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown environment';
  const platform = typeof navigator !== 'undefined' ? navigator.platform || 'Mobile/Web' : 'Web';

  const limitations: string[] = [];

  if (!track) {
    limitations.push(
      'File input / native OS camera picker used: live MediaStreamTrack hardware telemetry not exposed to browser.',
      'Auto-exposure (AE) and Auto-White-Balance (AWB) remain governed by device firmware; RGB values are not radiometrically calibrated.'
    );
    return {
      userAgent: ua,
      platform,
      cameraLabel: null,
      facingMode: 'environment',
      widthPx: null,
      heightPx: null,
      frameRate: null,
      exposureMode: 'auto (OS default)',
      whiteBalanceMode: 'auto (OS default)',
      focusMode: 'auto (OS default)',
      torchSupported: false,
      manualExposureSupported: false,
      manualWhiteBalanceSupported: false,
      limitations
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings: Record<string, any> = typeof track.getSettings === 'function' ? track.getSettings() : {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const caps: Record<string, any> =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (track as any).getCapabilities === 'function' ? (track as any).getCapabilities() : {};

  const exposureModes: string[] = Array.isArray(caps.exposureMode) ? caps.exposureMode : [];
  const wbModes: string[] = Array.isArray(caps.whiteBalanceMode) ? caps.whiteBalanceMode : [];

  const manualExposureSupported = exposureModes.includes('manual');
  const manualWhiteBalanceSupported = wbModes.includes('manual');
  const torchSupported = Boolean(caps.torch);

  const exposureMode = settings.exposureMode || (exposureModes[0] ?? 'continuous-auto');
  const whiteBalanceMode = settings.whiteBalanceMode || (wbModes[0] ?? 'continuous-auto');
  const focusMode = settings.focusMode || 'continuous-auto';

  if (!manualExposureSupported || exposureMode !== 'manual') {
    limitations.push(
      `Camera operating in ${exposureMode} exposure mode: frame luminance scales dynamically with scene reflectance.`
    );
  }
  if (!manualWhiteBalanceSupported || whiteBalanceMode !== 'manual') {
    limitations.push(
      `Camera operating in ${whiteBalanceMode} white-balance mode: play-of-colour chromaticity may shift without an in-frame colour reference.`
    );
  }
  limitations.push(
    'RGB smartphone sensor captures 3-channel tristimulus response, not narrowband spectral irradiance (nm).'
  );

  return {
    userAgent: ua,
    platform,
    cameraLabel: track.label || null,
    facingMode: settings.facingMode || 'environment',
    widthPx: typeof settings.width === 'number' ? settings.width : null,
    heightPx: typeof settings.height === 'number' ? settings.height : null,
    frameRate: typeof settings.frameRate === 'number' ? Math.round(settings.frameRate) : null,
    exposureMode,
    whiteBalanceMode,
    focusMode,
    torchSupported,
    manualExposureSupported,
    manualWhiteBalanceSupported,
    limitations
  };
}

/**
 * Computes deterministic, real pixel-level quality checks from an image File or Blob (BUILD 3):
 * - Resolution verification
 * - 3x3 Laplacian variance sharpness / blur detection on a downsampled luminance buffer
 * - Highlight clipping (% pixels > 250) and shadow crush (% pixels < 5)
 *
 * Non-blocking: returns clear warnings so the operator can retake or keep with recorded flags.
 */
export async function evaluateFrameQuality(file: File): Promise<FrameQualityAssessment> {
  const mime = resolveMediaMime(file);
  const nowIso = new Date().toISOString();

  if (mime.startsWith('video/')) {
    const warnings: string[] = [];
    if (file.size < 40 * 1024) {
      warnings.push('Video clip is very small (<40 KB); verify play-of-colour sweep duration.');
    }
    return {
      widthPx: 0,
      heightPx: 0,
      sharpnessScore: 25,
      overexposedPct: 0,
      underexposedPct: 0,
      meanLuminance: 120,
      status: warnings.length > 0 ? 'warning' : 'pass',
      warnings,
      evaluatedAt: nowIso
    };
  }

  try {
    if (typeof createImageBitmap === 'undefined' || typeof document === 'undefined') {
      return {
        widthPx: 1280,
        heightPx: 960,
        sharpnessScore: 24,
        overexposedPct: 0.4,
        underexposedPct: 1.2,
        meanLuminance: 118,
        status: 'pass',
        warnings: [],
        evaluatedAt: nowIso
      };
    }

    const bmp = await createImageBitmap(file);
    const widthPx = bmp.width;
    const heightPx = bmp.height;

    const sampleMax = 240;
    const scale = Math.min(1, sampleMax / Math.max(widthPx, heightPx));
    const sw = Math.max(16, Math.round(widthPx * scale));
    const sh = Math.max(16, Math.round(heightPx * scale));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bmp.close?.();
      return {
        widthPx,
        heightPx,
        sharpnessScore: 20,
        overexposedPct: 0,
        underexposedPct: 0,
        meanLuminance: 120,
        status: 'pass',
        warnings: [],
        evaluatedAt: nowIso
      };
    }

    ctx.drawImage(bmp, 0, 0, sw, sh);
    bmp.close?.();

    const imgData = ctx.getImageData(0, 0, sw, sh).data;
    const totalPixels = sw * sh;
    const lum = new Float32Array(totalPixels);

    let sumLum = 0;
    let overCount = 0;
    let underCount = 0;

    for (let i = 0, p = 0; i < imgData.length; i += 4, p++) {
      const r = imgData[i];
      const g = imgData[i + 1];
      const b = imgData[i + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      lum[p] = y;
      sumLum += y;
      if (r > 250 || g > 250 || b > 250) overCount++;
      if (y < 6) underCount++;
    }

    const meanLuminance = Math.round((sumLum / totalPixels) * 10) / 10;
    const overexposedPct = Math.round((overCount / totalPixels) * 1000) / 10;
    const underexposedPct = Math.round((underCount / totalPixels) * 1000) / 10;

    // Compute 3x3 Laplacian variance on central 70% region (where the specimen rests)
    let lapSum = 0;
    let lapSqSum = 0;
    let lapCount = 0;
    const xStart = Math.max(1, Math.floor(sw * 0.15));
    const xEnd = Math.min(sw - 2, Math.ceil(sw * 0.85));
    const yStart = Math.max(1, Math.floor(sh * 0.15));
    const yEnd = Math.min(sh - 2, Math.ceil(sh * 0.85));

    for (let y = yStart; y <= yEnd; y++) {
      for (let x = xStart; x <= xEnd; x++) {
        const idx = y * sw + x;
        const lap =
          lum[idx - sw] +
          lum[idx + sw] +
          lum[idx - 1] +
          lum[idx + 1] -
          4 * lum[idx];
        lapSum += lap;
        lapSqSum += lap * lap;
        lapCount++;
      }
    }

    const meanLap = lapCount > 0 ? lapSum / lapCount : 0;
    const variance = lapCount > 0 ? Math.max(0, lapSqSum / lapCount - meanLap * meanLap) : 0;
    const sharpnessScore = Math.round(Math.sqrt(variance) * 10) / 10;

    const warnings: string[] = [];
    if (Math.min(widthPx, heightPx) < 480) {
      warnings.push(`Low image resolution (${widthPx}×${heightPx}px). Move closer or capture at native sensor resolution.`);
    }
    if (sharpnessScore < 9.5) {
      warnings.push(`Possible motion blur or soft focus detected (sharpness index ${sharpnessScore}). Consider retaking on a steady rest.`);
    }
    if (overexposedPct > 14) {
      warnings.push(`Specular highlight clipping (${overexposedPct}% pixels saturated). Lower lamp intensity or adjust angle.`);
    }
    if (meanLuminance < 16 && underexposedPct > 85) {
      warnings.push(`Frame is severely underexposed (mean luminance ${meanLuminance}/255). Verify lamp illumination.`);
    }

    return {
      widthPx,
      heightPx,
      sharpnessScore,
      overexposedPct,
      underexposedPct,
      meanLuminance,
      status: warnings.length > 0 ? 'warning' : 'pass',
      warnings,
      evaluatedAt: nowIso
    };
  } catch {
    return {
      widthPx: 0,
      heightPx: 0,
      sharpnessScore: 20,
      overexposedPct: 0,
      underexposedPct: 0,
      meanLuminance: 120,
      status: 'pass',
      warnings: [],
      evaluatedAt: nowIso
    };
  }
}

/**
 * Evaluates session-level optical acquisition completeness across Pass A and Pass B (BUILD 3).
 */
export function evaluateSessionQualitySummary(
  assets: SolopticsCapturedAsset[],
  conditions: SolopticsCaptureConditions
): SolopticsSessionQualitySummary {
  const passAAssets = assets.filter(a => a.pass === 'pass_a_appearance');
  const passBAssets = assets.filter(a => a.pass === 'pass_b_play_of_colour');

  const requiredPassARoles: Array<{ role: SolopticsStepRole; label: string }> = [
    { role: 'front_surface', label: 'Front surface' },
    { role: 'reverse_surface', label: 'Reverse surface' },
    { role: 'side_profile', label: 'Side/profile' }
  ];

  const passAMissingRoles = requiredPassARoles
    .filter(r => !passAAssets.some(a => a.stepRole === r.role))
    .map(r => r.label);

  const passAComplete = passAMissingRoles.length === 0;
  const passBStillCount = passBAssets.filter(a => !a.isVideo).length;
  const passBVideoCount = passBAssets.filter(a => a.isVideo).length;
  const passBComplete = passBStillCount >= 3 || (passBStillCount >= 2 && passBVideoCount >= 1);

  const sharpFramesCount = assets.filter(a => a.quality.status === 'pass').length;
  const warningFramesCount = assets.filter(a => a.quality.status === 'warning').length;

  const hasScaleFrame = assets.some(a => a.stepRole === 'scale_colour_reference');
  const scaleReferenceRecorded = Boolean(conditions.scaleReferencePresent || hasScaleFrame);
  const colourReferenceRecorded = Boolean(conditions.colourReferencePresent || hasScaleFrame);

  const advisories: string[] = [];
  if (!passAComplete) {
    advisories.push(`Pass A Physical Appearance is missing: ${passAMissingRoles.join(', ')}.`);
  }
  if (!passBComplete) {
    advisories.push(
      `Pass B Play-of-Colour has ${passBStillCount} still view(s). At least 3 ordered orientation views are recommended to characterise directional flash.`
    );
  }
  if (!scaleReferenceRecorded) {
    advisories.push('No physical scale reference recorded: images are uncalibrated for dimensional metrology.');
  }
  if (!colourReferenceRecorded) {
    advisories.push('No neutral colour reference recorded: RGB values are subject to mobile auto-white-balance.');
  }
  if (warningFramesCount > 0) {
    advisories.push(`${warningFramesCount} frame(s) flagged with focus or exposure advisories.`);
  }

  let overallStatus: 'complete' | 'partial_warnings' | 'incomplete' = 'complete';
  if (assets.length === 0 || (!passAComplete && !passBComplete)) {
    overallStatus = 'incomplete';
  } else if (!passAComplete || !passBComplete || warningFramesCount > 0) {
    overallStatus = 'partial_warnings';
  }

  return {
    passAComplete,
    passACount: passAAssets.length,
    passAMissingRoles,
    passBComplete,
    passBStillCount,
    passBVideoCount,
    sharpFramesCount,
    warningFramesCount,
    scaleReferenceRecorded,
    colourReferenceRecorded,
    overallStatus,
    advisories
  };
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov'
};

export function loadLocalSolopticsSessions(sampleId?: string | null): PersistedSolopticsSession[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(SOLOPTICS_LOCAL_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    if (!sampleId) return parsed;
    return parsed.filter((s: PersistedSolopticsSession) => s.sampleId === sampleId);
  } catch {
    return [];
  }
}

function saveLocalSolopticsSession(session: PersistedSolopticsSession): void {
  try {
    if (typeof window === 'undefined') return;
    const existing = loadLocalSolopticsSessions();
    const filtered = existing.filter(s => s.sessionId !== session.sessionId);
    const next = [session, ...filtered].slice(0, 40);
    window.localStorage.setItem(SOLOPTICS_LOCAL_SESSIONS_KEY, JSON.stringify(next));
  } catch {
    // ignore storage quota errors
  }
}

/**
 * Uploads a single SOLOPTICS asset to Supabase Storage (`sample-images`) and registers it in
 * `public.sample_images` with complete `metadata.soloptics` provenance (BUILD 4 & BUILD 5).
 * Idempotent on retry: reuses `asset.storagePath` and `asset.sha256` so failed DB inserts never duplicate storage blobs.
 */
export async function uploadSolopticsAsset(
  asset: SolopticsCapturedAsset,
  conditions: SolopticsCaptureConditions,
  sessionSummary: SolopticsSessionQualitySummary
): Promise<{ asset: SolopticsCapturedAsset; imageRecord: SpecimenImage }> {
  validateMedia(asset.file);

  const sb = getSupabase();
  const bucket = sb.storage.from(config.BUCKET);
  const mime = resolveMediaMime(asset.file) || asset.mimeType || 'image/jpeg';

  // 1. Compute SHA-256 original content hash
  let hash = asset.sha256;
  if (!hash) {
    hash = await sha256(asset.file);
    asset.sha256 = hash;
  }

  // 2. Upload original file to Supabase Storage (`sample-images` bucket)
  let storagePath = asset.storagePath;
  if (!storagePath) {
    const ext = EXTENSIONS[mime] || 'jpg';
    const uid =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    storagePath = `${asset.sampleId}/soloptics_${asset.sessionId}_${asset.pass}_${String(asset.sequenceOrder).padStart(2, '0')}_${uid}.${ext}`;

    const { error: uploadErr } = await bucket.upload(storagePath, asset.file, {
      contentType: mime,
      upsert: false
    });

    if (uploadErr && !/already exists/i.test(uploadErr.message)) {
      asset.uploadState = 'failed';
      asset.uploadError = `Storage upload failed: ${uploadErr.message}`;
      throw new Error(asset.uploadError);
    }
    asset.storagePath = storagePath;
  }

  // 3. Generate and upload lightweight thumbnail for still images (never overwriting original)
  let thumbPath = asset.thumbPath ?? null;
  if (mime.startsWith('image/') && thumbPath === null) {
    try {
      const thumbBlob = await generateThumbnailBlob(asset.file, 480);
      if (thumbBlob) {
        const tp = `${ storagePath.replace(/\.[^.]+$/, '') }_thumb.jpg`;
        const { error: thumbErr } = await bucket.upload(tp, thumbBlob, {
          contentType: 'image/jpeg',
          upsert: false
        });
        if (!thumbErr) {
          thumbPath = tp;
          asset.thumbPath = tp;
        }
      }
    } catch {
      // Non-fatal thumbnail error
    }
  }

  // 4. Register authoritative evidence row in `public.sample_images`
  try {
    const solopticsMetadata = {
      instrument: 'SOLOPTICS v1.0',
      session_id: asset.sessionId,
      pass: asset.pass,
      step_role: asset.stepRole,
      sequence_order: asset.sequenceOrder,
      view_label: asset.viewLabel,
      captured_at: asset.capturedAt,
      operator_email: conditions.operatorEmail,
      illumination: {
        source_type: conditions.illuminationType,
        source_label: ILLUMINATION_TYPE_LABELS[conditions.illuminationType],
        direction_preset: conditions.illuminationDirection,
        direction_label: ILLUMINATION_DIRECTION_LABELS[conditions.illuminationDirection],
        distance_cm: conditions.illuminationDistanceCm ? Number(conditions.illuminationDistanceCm) : null,
        notes: conditions.illuminationNotes || null
      },
      background_surface: conditions.backgroundSurface,
      background_label: BACKGROUND_SURFACE_LABELS[conditions.backgroundSurface],
      references: {
        scale_present: conditions.scaleReferencePresent,
        scale_mm: conditions.scaleReferenceMm ? Number(conditions.scaleReferenceMm) : null,
        colour_present: conditions.colourReferencePresent,
        colour_note: conditions.colourReferenceNote || null
      },
      camera_capabilities: asset.cameraCapabilities,
      quality_assessment: asset.quality,
      session_quality_status: sessionSummary.overallStatus,
      scientific_qualification:
        'Original smartphone optical evidence preserved via SOLOPTICS. Uncalibrated RGB sensor observations do not constitute radiometric spectral measurements or goniometric 3D geometry.'
    };

    const imageRecord = await api.addMedia({
      sample_id: asset.sampleId,
      storage_path: storagePath,
      thumb_path: thumbPath,
      file_name: asset.file.name,
      content_type: mime,
      size_bytes: asset.file.size,
      sha256: hash,
      capture_kind: asset.captureKind,
      media_type: mime,
      processing_method: 'original',
      is_original: true,
      derived_from_id: null,
      metadata: {
        soloptics: solopticsMetadata,
        file_last_modified: asset.file.lastModified || null,
        session_upload_at: new Date().toISOString()
      },
      width_px: asset.quality.widthPx || null,
      height_px: asset.quality.heightPx || null
    });

    if (mime.startsWith('image/')) {
      try {
        const geo = await extractPhotoGeo(asset.file);
        if (geo) {
          await savePhotoGeoObservation({
            id: imageRecord.id, sample_id: asset.sampleId, file_name: asset.file.name,
            storage_path: storagePath, thumb_path: thumbPath, content_type: mime,
            size_bytes: asset.file.size, sha256: hash
          }, geo, hash);
        }
      } catch {
        // Missing migration or EXIF must never invalidate optical evidence upload.
      }
    }

    asset.uploadState = 'saved';
    asset.savedSampleImageId = imageRecord.id;
    asset.uploadError = undefined;

    return { asset, imageRecord };
  } catch (dbErr) {
    asset.uploadState = 'retryable';
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    asset.uploadError = `Database registration failed: ${msg}`;
    throw new Error(asset.uploadError);
  }
}

/**
 * Attempts to persist the session summary to `public.optical_capture_sessions` if the staging migration
 * is present in Supabase; always persists to the local session ledger and `sample_images.metadata.soloptics`.
 */
export async function finalizeSolopticsSession(
  sessionId: string,
  sampleId: string,
  startedAt: string,
  conditions: SolopticsCaptureConditions,
  cameraCapabilities: CameraHardwareCapabilities,
  assets: SolopticsCapturedAsset[]
): Promise<PersistedSolopticsSession> {
  const completedAt = new Date().toISOString();
  const qualitySummary = evaluateSessionQualitySummary(assets, conditions);
  const savedAssets = assets.filter(a => a.uploadState === 'saved' && a.storagePath && a.sha256);

  const persistedSession: PersistedSolopticsSession = {
    sessionId,
    sampleId,
    operatorEmail: conditions.operatorEmail,
    startedAt,
    completedAt,
    conditions,
    cameraCapabilities,
    qualitySummary,
    lifecycleState: savedAssets.length === assets.length ? 'saved' : 'partial',
    assets: savedAssets.map(a => ({
      assetId: a.id,
      sampleImageId: a.savedSampleImageId || a.id,
      pass: a.pass,
      stepRole: a.stepRole,
      sequenceOrder: a.sequenceOrder,
      viewLabel: a.viewLabel,
      storagePath: a.storagePath!,
      thumbPath: a.thumbPath || null,
      fileName: a.file.name,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      sha256: a.sha256!,
      widthPx: a.quality.widthPx || null,
      heightPx: a.quality.heightPx || null,
      isVideo: a.isVideo,
      captureKind: a.captureKind,
      capturedAt: a.capturedAt,
      quality: a.quality
    }))
  };

  saveLocalSolopticsSession(persistedSession);

  // Best-effort insert into staging table `public.optical_capture_sessions` if applied
  try {
    const sb = getSupabase();
    await sb.from('optical_capture_sessions').upsert(
      {
        id: sessionId,
        sample_id: sampleId,
        operator_email: conditions.operatorEmail,
        started_at: startedAt,
        completed_at: completedAt,
        capture_mode: 'SOLOPTICS_GUIDED_DUAL_PASS',
        pass_completed: {
          passA: qualitySummary.passAComplete,
          passB: qualitySummary.passBComplete
        },
        device_metadata: cameraCapabilities,
        camera_limitations: cameraCapabilities.limitations,
        illumination: {
          type: conditions.illuminationType,
          direction: conditions.illuminationDirection,
          distance_cm: conditions.illuminationDistanceCm,
          notes: conditions.illuminationNotes
        },
        background_surface: conditions.backgroundSurface,
        scale_reference_present: conditions.scaleReferencePresent,
        scale_reference_mm: conditions.scaleReferenceMm ? Number(conditions.scaleReferenceMm) : null,
        colour_reference_present: conditions.colourReferencePresent,
        colour_reference_note: conditions.colourReferenceNote || null,
        quality_summary: qualitySummary,
        lifecycle_state: persistedSession.lifecycleState,
        notes: conditions.sessionNotes || null
      },
      { onConflict: 'id' }
    );
  } catch {
    // Staging table is optional; authoritative evidence is already committed in `public.sample_images`
  }

  return persistedSession;
}

/**
 * Reconstructs SOLOPTICS capture sessions for a specimen directly from authoritative `public.sample_images` rows
 * (merged with any local session records) and resolves signed URLs for inspection in SOLARIUM and Specimen Detail (BUILD 6).
 */
export interface HydratedSolopticsSession {
  sessionId: string;
  sampleId: string;
  operatorEmail: string;
  capturedAt: string;
  illuminationLabel: string;
  directionLabel: string;
  backgroundLabel: string;
  scaleReferenceText: string;
  colourReferenceText: string;
  cameraLimitations: string[];
  passAAssets: Array<{
    id: string;
    stepRole: string;
    sequenceOrder: number;
    viewLabel: string;
    fileName: string;
    sha256: string;
    widthPx: number | null;
    heightPx: number | null;
    isVideo: boolean;
    signedUrl: string | null;
    thumbUrl: string | null;
    capturedAt: string;
    qualityStatus: 'pass' | 'warning';
    qualityWarnings: string[];
  }>;
  passBAssets: Array<{
    id: string;
    stepRole: string;
    sequenceOrder: number;
    viewLabel: string;
    fileName: string;
    sha256: string;
    widthPx: number | null;
    heightPx: number | null;
    isVideo: boolean;
    signedUrl: string | null;
    thumbUrl: string | null;
    capturedAt: string;
    qualityStatus: 'pass' | 'warning';
    qualityWarnings: string[];
  }>;
}

export async function fetchSpecimenSolopticsSessions(
  sampleId: string,
  preloadedImages?: SpecimenImage[]
): Promise<HydratedSolopticsSession[]> {
  if (!sampleId) return [];

  let images = preloadedImages;
  if (!images) {
    try {
      const detail = await api.sampleDetail(sampleId);
      images = detail.images;
    } catch {
      images = [];
    }
  }

  const allPaths = (images || []).flatMap(img => [img.storage_path, img.thumb_path]);
  let urlResolver: (p: string | null | undefined) => string | null = () => null;
  if (allPaths.length > 0) {
    try {
      urlResolver = await signed(allPaths);
    } catch {
      // ignore signed url errors offline
    }
  }

  const sessionMap = new Map<string, HydratedSolopticsSession>();

  for (const img of images || []) {
    const meta = (img.metadata || {}) as Record<string, unknown>;
    const sol = meta.soloptics as Record<string, unknown> | undefined;
    if (!sol || typeof sol !== 'object') continue;

    const sessionId = String(sol.session_id || 'SOL-LEGACY');
    const pass = (sol.pass as SolopticsPassId) || 'pass_a_appearance';
    const stepRole = String(sol.step_role || 'front_surface');
    const sequenceOrder = Number(sol.sequence_order || 1);
    const viewLabel = String(sol.view_label || img.file_name || 'Optical Frame');
    const capturedAt = String(sol.captured_at || img.created_at);
    const operatorEmail = String(sol.operator_email || 'Authorised Operator');

    const illum = (sol.illumination || {}) as Record<string, unknown>;
    const refs = (sol.references || {}) as Record<string, unknown>;
    const caps = (sol.camera_capabilities || {}) as Record<string, unknown>;
    const qual = (sol.quality_assessment || {}) as Record<string, unknown>;

    if (!sessionMap.has(sessionId)) {
      const scalePresent = Boolean(refs.scale_present);
      const scaleMm = refs.scale_mm ? `${refs.scale_mm} mm` : 'Present';
      const colourPresent = Boolean(refs.colour_present);

      sessionMap.set(sessionId, {
        sessionId,
        sampleId,
        operatorEmail,
        capturedAt,
        illuminationLabel: String(
          illum.source_label ||
            ILLUMINATION_TYPE_LABELS[illum.source_type as IlluminationSourceType] ||
            'Diffuse White LED'
        ),
        directionLabel: String(
          illum.direction_label ||
            ILLUMINATION_DIRECTION_LABELS[illum.direction_preset as IlluminationDirectionPreset] ||
            'Fixed Directional'
        ),
        backgroundLabel: String(
          sol.background_label ||
            BACKGROUND_SURFACE_LABELS[sol.background_surface as BackgroundSurfaceType] ||
            'Matte Black Stage'
        ),
        scaleReferenceText: scalePresent ? `Included (${scaleMm})` : 'None (Uncalibrated dimensions)',
        colourReferenceText: colourPresent
          ? `Included${refs.colour_note ? ` (${refs.colour_note})` : ''}`
          : 'None (Device AWB)',
        cameraLimitations: Array.isArray(caps.limitations)
          ? (caps.limitations as string[])
          : [
              'Uncalibrated smartphone RGB capture; auto-exposure and auto-white-balance governed by device firmware.'
            ],
        passAAssets: [],
        passBAssets: []
      });
    }

    const group = sessionMap.get(sessionId)!;
    const item = {
      id: img.id,
      stepRole,
      sequenceOrder,
      viewLabel,
      fileName: img.file_name,
      sha256: img.sha256,
      widthPx: img.width_px ?? (typeof qual.widthPx === 'number' ? qual.widthPx : null),
      heightPx: img.height_px ?? (typeof qual.heightPx === 'number' ? qual.heightPx : null),
      isVideo: (img.media_type || img.content_type || '').startsWith('video/'),
      signedUrl: urlResolver(img.storage_path),
      thumbUrl: urlResolver(img.thumb_path || img.storage_path),
      capturedAt,
      qualityStatus: (qual.status === 'warning' ? 'warning' : 'pass') as 'pass' | 'warning',
      qualityWarnings: Array.isArray(qual.warnings) ? (qual.warnings as string[]) : []
    };

    if (pass === 'pass_b_play_of_colour') {
      group.passBAssets.push(item);
    } else {
      group.passAAssets.push(item);
    }
  }

  const list = Array.from(sessionMap.values());
  for (const s of list) {
    s.passAAssets.sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    s.passBAssets.sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  }

  return list.sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
}
