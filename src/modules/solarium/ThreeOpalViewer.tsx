import React, { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ---------------------------------------------------------------------------
// SINGLE SOURCES OF TRUTH
// The scene light, the shader light and the HUD telemetry all read these two
// values, so they can no longer drift apart.
// ---------------------------------------------------------------------------

// ONE lamp, as in the shoot that produced the reference video (IMG_6812.mov):
//   camera 240 mm from the stone; one lamp ~280 mm above it and 30 degrees round to
//   the right of the camera axis (assumed the same 240 mm out toward the camera).
// Direction below is that lamp, in CAMERA space (x right, y up, z toward the camera).
// By default the lamp travels with the camera, so dragging the stone around gives
// exactly what turning it on a turntable gives.
// NOTE: the baked orientation image (Matrixtwin_opal_domain.png) was fitted using this
// exact direction. If you change it, the images must be re-baked.
const LAMP_CAMERA_SPACE = new THREE.Vector3(
  240 * Math.sin(THREE.MathUtils.degToRad(30)),
  280,
  240 * Math.cos(THREE.MathUtils.degToRad(30))
).normalize();
const LAMP_DISTANCE = 7.07;
const KEY_LIGHT_POS = LAMP_CAMERA_SPACE.clone().multiplyScalar(LAMP_DISTANCE);

// Opening pose (three.js Euler XYZ, degrees): the flat face turned to the
// camera, as at 0:00 and 0:07 of the reference video (IMG_6812.mov), where the
// green mosaic is on. Fitted by matching the model outline to the video frame.
const HERO_POSE_DEG = { pitch: -10.2, yaw: 9.0, roll: -5.5 };

// Optical constants. These must match the numpy model the textures were baked
// with, because the baked orientation image assumes this lamp and these lobes.
const OPAL_N_SILICA = 1.45;
const OPAL_D_GREEN_NM = 184.0;   // lattice spacing of the green domains (emerald green at the peak: ~505 nm)
const OPAL_D_BLUE_NM = 158.0;    // lattice spacing of the blue/violet domains (violet-blue at the peak: ~434 nm)
const OPAL_FLASH_GAIN = 0.80;
const KEY_LIGHT_INTENSITY = 2.0;

// FRONT OF THE STONE, in the GLB's local space.
// Measured from Matrixtwin_opal.glb: best-fit plane of the large flat face on
// the +Z side (~22,000 vertices, 1.3 x 1.1 units, flat to ~2% of stone width).
// This is the face that carries the green and blue play-of-colour in the
// reference video. The opposite (-Z) face is the dull reverse.
// Use "CAPTURE PHYSICAL FRONT" to override it, "RESET FRONT" to return to this.
const MEASURED_FRONT_LOCAL = new THREE.Vector3(-0.183, -0.215, 0.959).normalize();

export interface ProjectedFeature {
  id: string;
  x: number;
  y: number;
  visible: boolean;
  worldX?: number;
  worldY?: number;
  worldZ?: number;
}

export interface OpticalBench3DPoints {
  anchor: { x: number; y: number; visible: boolean };
  lightSource: { x: number; y: number; visible: boolean };
  normalTip: { x: number; y: number; visible: boolean };
  observerTip: { x: number; y: number; visible: boolean };
  arcMid: { x: number; y: number; visible: boolean };
}

export interface MatrixBench3DPoints {
  anchor: { x: number; y: number; visible: boolean };
  axisTip: { x: number; y: number; visible: boolean };
  planeOrigin: { x: number; y: number; visible: boolean };
  sectionMarker: { x: number; y: number; visible: boolean };
}

export interface OpticalMetrics {
  angleOfIncidence: number;
  viewAngle: number;
  lightAzimuthDeg: number;
  relativeIllumination: string;
  specularAlignment: number;
}

interface ThreeOpalViewerProps {
  lighting?: { azimuth: number; elevation: number; intensity: number; ambient: number };
  modelUrl?: string;
  dracoDecoderPath?: string;
  /** Optional per-stone maps; otherwise resolved next to the GLB. */
  opticalMaps?: { flash: string; domain: string };
  /**
   * 'camera' (default): the lamp travels with the camera, so orbiting the stone
   * is equivalent to turning it on a turntable under a fixed lamp.
   * 'fixed': the lamp stays where it was at load time while the camera orbits.
   */
  lampMode?: 'camera' | 'fixed';
  className?: string;
  features?: string[];
  autoRotate?: boolean;
  activeFeatureId?: string | null;
  instrumentMode?: 'observe' | 'investigate' | 'model' | 'verify';
  sectionEnabled?: boolean;
  sectionOffset?: number;
  onFeaturesProjected?: (features: ProjectedFeature[]) => void;
  onActiveFeatureChange?: (id: string) => void;
  onCameraChange?: (distance: number) => void;
  onOrientationChange?: (azimuthDeg: number, inclinationDeg: number) => void;
  onOpticalMetricsChange?: (metrics: OpticalMetrics) => void;
  onOpticalBenchProjected?: (bench: OpticalBench3DPoints) => void;
  onMatrixBenchProjected?: (bench: MatrixBench3DPoints) => void;
  onFeatureSelect?: (id: string | null) => void;
  onInteractionStart?: () => void;
  /**
   * Show the developer panels (optical diagnostics and the video-locked calibration rig).
   * Default true, so the Provenance Project behaves exactly as before. Switch it off
   * for anything the public sees, such as the store.
   */
  showInstruments?: boolean;
  /**
   * If the model cannot be loaded, draw the built-in procedural stand-in stone (default,
   * true). In a shop that would show a made-up stone, so set this to false: the viewer
   * then reports the problem through onLoadError and the page can show the real photo.
   */
  proceduralFallback?: boolean;
  /** Called once the real model is on screen. Use it to fade out a poster photo. */
  onReady?: () => void;
  /** Called if WebGL is unavailable, the graphics context is lost, or the model fails to load. */
  onLoadError?: () => void;
  /**
   * Mouse wheel / pinch zoom (default true). Switch it off on a page that scrolls, so the
   * wheel scrolls the page instead of zooming the stone when the pointer is over it.
   */
  enableZoom?: boolean;
  /**
   * Touch gestures the viewer takes over. 'none' (default) gives full turn-and-tilt on
   * phones but stops the page scrolling under the finger. 'pan-y' lets vertical swipes
   * scroll the page and keeps sideways swipes for turning the stone.
   */
  touchAction?: 'none' | 'pan-y';
  /**
   * Keep the whole stone in frame on tall, narrow screens (default false). The camera frames
   * the stone by height, which is right for a wide window but crops a landscape stone on a
   * phone held upright. With this on, the camera backs away just enough for the stone's
   * width to fit, and goes back to the normal distance on any screen wider than about square.
   */
  fitWidth?: boolean;
}

// Camera distance the viewer is tuned for, and the narrowest screen shape (width / height)
// at which the whole stone still fits at that distance. Narrower than that, fitWidth backs
// the camera off in proportion.
const BASE_CAMERA_DISTANCE = 4.8;
const FIT_MIN_ASPECT = 1.06;
const fitScaleForAspect = (aspect: number) => Math.max(1, FIT_MIN_ASPECT / Math.max(aspect, 0.2));

export interface ThreeOpalViewerRef {
  getCamera: () => THREE.PerspectiveCamera | null; 
  getScene: () => THREE.Scene | null;
  resetView: () => void;
  setCameraDistance: (dist: number) => void;
}

export const ThreeOpalViewer = React.forwardRef<ThreeOpalViewerRef, ThreeOpalViewerProps>(function ThreeOpalViewer({
  lighting = { azimuth: 30, elevation: 49.398705, intensity: 100, ambient: 10 },
  modelUrl = '/solarium/models/Matrixtwin_opal.glb',
  dracoDecoderPath = '/solarium/draco/',
  opticalMaps,
  lampMode = 'camera',
  className = '',
  features = [],
  autoRotate = false,
  activeFeatureId = null,
  instrumentMode = 'observe',
  sectionEnabled = false,
  sectionOffset = 0,
  onFeaturesProjected,
  onActiveFeatureChange,
  onCameraChange,
  onOrientationChange,
  onOpticalMetricsChange,
  onOpticalBenchProjected,
  onMatrixBenchProjected,
  onFeatureSelect,
  onInteractionStart,
  showInstruments = true,
  proceduralFallback = true,
  onReady,
  onLoadError,
  enableZoom = true,
  touchAction = 'none',
  fitWidth = false,
}, ref) {
  const lightingRef = useRef(lighting);
  lightingRef.current = lighting;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [debugMode, setDebugMode] = React.useState(6);
  const [capturedFrontLocal, setCapturedFrontLocal] = React.useState<THREE.Vector3 | null>(null);
  const [capturedFrontWorld, setCapturedFrontWorld] = React.useState<THREE.Vector3 | null>(null);
  const debugModeRef = useRef({ value: 6 });
  // Shared uniform objects: every material's shader points at these same objects,
  // so writing .value here updates the whole stone immediately.
  const specimenFrontUniformRef = useRef({ value: MEASURED_FRONT_LOCAL.clone() });
  const keyLightDirUniformRef = useRef({ value: KEY_LIGHT_POS.clone().normalize() });
  const keyLightStrengthUniformRef = useRef({ value: 1.0 });
  const flashTexelSizeUniformRef = useRef({ value: new THREE.Vector2(1 / 2048, 1 / 2048) });
  const resetPhysicalFrontRef = React.useRef<(() => void) | null>(null);

  // Flash textures baked from the video (see Matrixtwin_opal_flash.png / _domain.png)
  //   flash  : R = green play-of-colour potential, G = blue/violet potential
  //   domain : RGB = direction the opal layers face, in the stone's local space
  const flashMaskUniformRef = useRef<{ value: THREE.Texture | null }>({ value: null });
  const domainMapUniformRef = useRef<{ value: THREE.Texture | null }>({ value: null });
  const hasFlashTexturesUniformRef = useRef({ value: false });
  // Where the lamp is in world space right now (updated every frame).
  const lampWorldPosRef = useRef(KEY_LIGHT_POS.clone());
  const lampModeRef = useRef<'camera' | 'fixed'>(lampMode);
  useEffect(() => { lampModeRef.current = lampMode; }, [lampMode]);

  // DIRECTIVE 17: Developer Video-Locked Calibration Rig State
  const [showCalibrationRig, setShowCalibrationRig] = React.useState(false);
  const [calibrationTelemetry, setCalibrationTelemetry] = React.useState({
    yawDeg: 0,
    pitchDeg: 0,
    rollDeg: 0,
    camAzimuth: 0,
    camElevation: 0,
    camDistance: 4.8,
    camPos: [0, 0, 4.8] as [number, number, number],
    camDir: [0, 0, -1] as [number, number, number],
    keyLightPos: [4.0, 5.0, 3.0] as [number, number, number],
    L: [0.57, 0.71, 0.43] as [number, number, number],
    V: [0.0, 0.0, 1.0] as [number, number, number],
    H: [0.35, 0.44, 0.83] as [number, number, number],
    flashFactor: 0,
    greenResponse: 0,
    cosThetaI: 0,
    cosThetaV: 0,
    cosHalf: 0,
    lambdaGreen: 0,
    lambdaBlue: 0,
    blueResponse: 0,
    totalResponse: 0,
    activePresetId: 'custom',
  });

  const setModelOrientationFnRef = useRef<((yaw: number, pitch: number, roll: number, presetId?: string) => void) | null>(null);

  React.useEffect(() => {
    debugModeRef.current.value = debugMode;
    modelMaterialsRef.current.forEach(mat => {
      if ((mat as any).userData?.shader?.uniforms?.uDebugMode) {
        (mat as any).userData.shader.uniforms.uDebugMode.value = debugMode;
      }
    });
  }, [debugMode]);
  
  const featuresRef = useRef(features);
  const activeFeatureIdRef = useRef(activeFeatureId);
  const instrumentModeRef = useRef(instrumentMode);
  const sectionEnabledRef = useRef(sectionEnabled);
  const sectionOffsetRef = useRef(sectionOffset);
  const onFeaturesProjectedRef = useRef(onFeaturesProjected);
  const onActiveFeatureChangeRef = useRef(onActiveFeatureChange);
  const onCameraChangeRef = useRef(onCameraChange);
  const onOrientationChangeRef = useRef(onOrientationChange);
  const onOpticalMetricsChangeRef = useRef(onOpticalMetricsChange);
  const onOpticalBenchProjectedRef = useRef(onOpticalBenchProjected);
  const onMatrixBenchProjectedRef = useRef(onMatrixBenchProjected);
  const onFeatureSelectRef = useRef(onFeatureSelect);
  const onInteractionStartRef = useRef(onInteractionStart);
  const autoRotateRef = useRef(autoRotate);
  const showInstrumentsRef = useRef(showInstruments);
  const proceduralFallbackRef = useRef(proceduralFallback);
  const onReadyRef = useRef(onReady);
  const onLoadErrorRef = useRef(onLoadError);
  const enableZoomRef = useRef(enableZoom);
  const touchActionRef = useRef(touchAction);
  const fitWidthRef = useRef(fitWidth);
  // How far the camera has been backed off from BASE_CAMERA_DISTANCE to fit a narrow screen (1 = not at all)
  const fitScaleRef = useRef(1);
  const modelMaterialsRef = useRef<THREE.Material[]>([]);
  const capturePhysicalFrontRef = React.useRef<(() => void) | null>(null);

  // Camera Observation Memory & Optical Transition State
  const savedObservationRef = useRef<{
    position: THREE.Vector3;
    target: THREE.Vector3;
    fov: number;
    distance: number;
  } | null>(null);

  const transitionRef = useRef<{
    active: boolean;
    startTime: number;
    duration: number;
    startPos: THREE.Vector3;
    targetPos: THREE.Vector3;
    startTarget: THREE.Vector3;
    targetTarget: THREE.Vector3;
    startFov: number;
    targetFov: number;
  }>({
    active: false,
    startTime: 0,
    duration: 650,
    startPos: new THREE.Vector3(),
    targetPos: new THREE.Vector3(),
    startTarget: new THREE.Vector3(),
    targetTarget: new THREE.Vector3(),
    startFov: 35,
    targetFov: 35,
  });

  const triggerFocusTransitionRef = useRef<(featId: string | null) => void>(() => {});

  useEffect(() => {
    featuresRef.current = features;
  }, [features]);

  useEffect(() => {
    activeFeatureIdRef.current = activeFeatureId;
    triggerFocusTransitionRef.current?.(activeFeatureId);
  }, [activeFeatureId]);

  useEffect(() => {
    instrumentModeRef.current = instrumentMode;
  }, [instrumentMode]);

  useEffect(() => {
    sectionEnabledRef.current = sectionEnabled;
  }, [sectionEnabled]);

  useEffect(() => {
    sectionOffsetRef.current = sectionOffset;
  }, [sectionOffset]);

  useEffect(() => {
    onFeaturesProjectedRef.current = onFeaturesProjected;
  }, [onFeaturesProjected]);

  useEffect(() => {
    onActiveFeatureChangeRef.current = onActiveFeatureChange;
  }, [onActiveFeatureChange]);

  useEffect(() => {
    onCameraChangeRef.current = onCameraChange;
  }, [onCameraChange]);

  useEffect(() => {
    onOrientationChangeRef.current = onOrientationChange;
  }, [onOrientationChange]);

  useEffect(() => {
    onOpticalMetricsChangeRef.current = onOpticalMetricsChange;
  }, [onOpticalMetricsChange]);

  useEffect(() => {
    onOpticalBenchProjectedRef.current = onOpticalBenchProjected;
  }, [onOpticalBenchProjected]);

  useEffect(() => {
    onMatrixBenchProjectedRef.current = onMatrixBenchProjected;
  }, [onMatrixBenchProjected]);

  useEffect(() => {
    onFeatureSelectRef.current = onFeatureSelect;
  }, [onFeatureSelect]);

  useEffect(() => {
    onInteractionStartRef.current = onInteractionStart;
  }, [onInteractionStart]);

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    showInstrumentsRef.current = showInstruments;
    proceduralFallbackRef.current = proceduralFallback;
    onReadyRef.current = onReady;
    onLoadErrorRef.current = onLoadError;
  }, [showInstruments, proceduralFallback, onReady, onLoadError]);

  useEffect(() => {
    enableZoomRef.current = enableZoom;
    touchActionRef.current = touchAction;
    fitWidthRef.current = fitWidth;
    if (controlsRef.current) controlsRef.current.enableZoom = enableZoom;
    if (canvasRef.current) canvasRef.current.style.touchAction = touchAction;
  }, [enableZoom, touchAction, fitWidth]);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const strataGroupRef = useRef<THREE.Group | null>(null);
  const territoryGroupRef = useRef<THREE.Group | null>(null);

  React.useImperativeHandle(ref, () => ({
    getCamera: () => cameraRef.current,
    getScene: () => sceneRef.current,
    resetView: () => {
      if (controlsRef.current && cameraRef.current) {
        controlsRef.current.reset();
        cameraRef.current.position.set(0, 0, BASE_CAMERA_DISTANCE * fitScaleRef.current);
        controlsRef.current.update();
      }
    },
    setCameraDistance: (dist: number) => {
      if (cameraRef.current && controlsRef.current) {
        const dir = cameraRef.current.position.clone().normalize();
        cameraRef.current.position.copy(dir.multiplyScalar(dist));
        controlsRef.current.update();
      }
    }
  }));

  const applyOpticalDiffractionShader = useCallback((mat: THREE.MeshStandardMaterial, isOpalSeam: boolean = false) => {
    mat.customProgramCacheKey = () => (isOpalSeam ? 'opal-diffract-seam-v7' : 'opal-diffract-matrix-v7');
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uOpalCenter = { value: new THREE.Vector3(0.35, 0.45, 0.65) };
      shader.uniforms.uOpalRadius = { value: 0.95 };
      shader.uniforms.uLocalBoundsMin = { value: new THREE.Vector3(-0.951144, -0.555493, -0.546964) };
      shader.uniforms.uLocalBoundsMax = { value: new THREE.Vector3(0.950102, 0.554592, 0.548624) };
      shader.uniforms.uKeyLightDir = keyLightDirUniformRef.current;
      shader.uniforms.uKeyLightStrength = keyLightStrengthUniformRef.current;
      shader.uniforms.uFlashTexelSize = flashTexelSizeUniformRef.current;
      shader.uniforms.uSpecimenFrontLocal = specimenFrontUniformRef.current;
      shader.uniforms.uSpecimenUpLocal = { value: new THREE.Vector3(0.0, 1.0, 0.0).normalize() };
      shader.uniforms.uDebugMode = debugModeRef.current;
      // Shared with the loader below: filled in when the two PNGs arrive.
      shader.uniforms.uPreciousOpalMask = flashMaskUniformRef.current;
      shader.uniforms.uDomainMap = domainMapUniformRef.current;
      shader.uniforms.uHasPreciousOpalMask = hasFlashTexturesUniformRef.current;
      shader.uniforms.uNSilica = { value: OPAL_N_SILICA };
      shader.uniforms.uDGreen = { value: OPAL_D_GREEN_NM };
      shader.uniforms.uDBlue = { value: OPAL_D_BLUE_NM };
      shader.uniforms.uFlashGain = { value: OPAL_FLASH_GAIN };

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vOpalLocalPos;
        varying vec3 vOpalWorldPos;
        varying vec3 vOpalWorldNormal;
        varying vec3 vOpalLocalNormal;
        varying mat3 vOpalWorldRotation;
`
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vOpalLocalPos = position;
        vOpalLocalNormal = normal;
        vOpalWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vOpalWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vOpalWorldRotation = mat3(modelMatrix);
`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vOpalLocalPos;
        varying vec3 vOpalLocalNormal;
        varying vec3 vOpalWorldPos;
        varying vec3 vOpalWorldNormal;
        varying mat3 vOpalWorldRotation;

        uniform vec3 uOpalCenter;
        uniform float uOpalRadius;
        uniform vec3 uLocalBoundsMin;
        uniform vec3 uLocalBoundsMax;
        uniform vec3 uKeyLightDir;
        uniform float uKeyLightStrength;
        uniform vec2 uFlashTexelSize;
        uniform vec3 uSpecimenFrontLocal;
        uniform vec3 uSpecimenUpLocal;
        uniform int uDebugMode;
        uniform sampler2D uPreciousOpalMask;   // R green potential, G blue potential (baked from the video)
        uniform sampler2D uDomainMap;          // RGB = opal-layer direction (local space) * 0.5 + 0.5
        uniform bool uHasPreciousOpalMask;
        uniform float uNSilica;
        uniform float uDGreen;
        uniform float uDBlue;
        uniform float uFlashGain;
        
        // Global mask variables for optical separation
        float g_preciousOpalMask = 0.0;
        float g_greenFireMask = 0.0;
        float g_blueFireMask = 0.0;
        float g_totalFireMask = 0.0;
        vec3 g_opalFire = vec3(0.0);

        // Forensic Occurrence Autopsy Variables (Directive 17B Isolation Diagnostics)
        float g_testGreenLodeRaw = 0.0;
        float g_testBlueShoulderRaw = 0.0;
        float g_testGreenMatrixPass = 0.0;
        float g_testGreenFrontFaceLock = 0.0;
        float g_testGreenBaseCutoff = 0.0;
        float g_testGreenLeftBaseCutoff = 0.0;
        float g_testGreenAllGates = 0.0;
        float g_testBlueMatrixPass = 0.0;
        float g_testBlueFrontFaceLock = 0.0;
        float g_testBlueBaseCutoff = 0.0;
        float g_testBlueLeftBaseCutoff = 0.0;
        float g_testBlueAllGates = 0.0;
        float g_testOutGreenDomain = 0.0;
        float g_testOutBlueDomain = 0.0;
        float g_testGreenLodeRawXY = 0.0;
        float g_testDepthEnvelope = 0.0;
        float g_testFrontFaceLock = 0.0;
        float g_testSpecimenPosZ = 0.0;

        // --- CONTINUOUS 3D NOISE & OPTICAL ORIENTATION FIELD ENGINE ---
        // Developed with Jim Shaw: Replaces discrete Cartesian grid quantization (floor)
        // with smooth, multi-scale C1-continuous domain-warped orientation fields.

        // Fast C1-continuous 3D value-gradient noise with quintic Hermite interpolation
        float opalHash13(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.zyx + 31.32);
          return fract((p.x + p.y) * p.z);
        }

        vec3 opalHash33(vec3 p) {
          p = fract(p * vec3(443.897, 441.423, 437.195));
          p += dot(p, p.yxz + 19.19);
          return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
        }

        float opalNoise3D(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          // Quintic Hermite interpolation curve (C1 smooth derivatives, zero grid seams)
          vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

          float n000 = dot(opalHash33(i + vec3(0.0, 0.0, 0.0)), f - vec3(0.0, 0.0, 0.0));
          float n100 = dot(opalHash33(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
          float n010 = dot(opalHash33(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
          float n110 = dot(opalHash33(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
          float n001 = dot(opalHash33(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
          float n101 = dot(opalHash33(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
          float n011 = dot(opalHash33(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
          float n111 = dot(opalHash33(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));

          return mix(
            mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
            mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
            u.z
          );
        }

        // Domain warping to organically disrupt all Cartesian XYZ alignment
        vec3 opalDomainWarp(vec3 p) {
          vec3 q = vec3(
            opalNoise3D(p + vec3(0.0, 0.0, 0.0)),
            opalNoise3D(p + vec3(5.2, 1.3, 2.8)),
            opalNoise3D(p + vec3(2.1, 7.8, 4.4))
          );
          return p + q * 0.45;
        }

        // Continuous fractional Brownian motion in warped object space
        float opalFBM(vec3 p) {
          vec3 wp = opalDomainWarp(p);
          float value = 0.0;
          float amp = 0.55;
          float freq = 1.0;
          for (int i = 0; i < 3; i++) {
            value += amp * opalNoise3D(wp * freq);
            freq *= 2.15;
            amp *= 0.48;
          }
          return value;
        }

        // Multi-scale continuous optical orientation field (macro, meso, micro)
        // Produces cohesive organic sheets with subtle internal undulation (max ±5.5° deviation)
        vec3 opalOrientationField(vec3 localPos, vec3 baseNormal) {
          vec3 wp = opalDomainWarp(localPos * 4.5);
          
          // Macro domain (low frequency, smooth organic ribbon flow)
          vec3 macroPerturb = vec3(
            opalNoise3D(wp * 2.2 + vec3(0.0, 1.2, 3.4)),
            opalNoise3D(wp * 2.2 + vec3(4.1, 0.5, 1.9)),
            opalNoise3D(wp * 2.2 + vec3(2.3, 3.8, 0.7))
          ) * 0.085;

          // Meso domain (mid frequency, internal facet undulation)
          vec3 mesoPerturb = vec3(
            opalNoise3D(wp * 7.5 + vec3(1.1, 2.3, 0.5)),
            opalNoise3D(wp * 7.5 + vec3(3.2, 0.9, 4.1)),
            opalNoise3D(wp * 7.5 + vec3(0.4, 4.7, 2.2))
          ) * 0.038;

          // Micro domain (subtle high frequency organic microfacet texture, zero pixel glitter)
          vec3 microPerturb = vec3(
            opalNoise3D(localPos * 24.0),
            opalNoise3D(localPos * 24.0 + vec3(5.0, 2.0, 1.0)),
            opalNoise3D(localPos * 24.0 + vec3(2.0, 7.0, 4.0))
          ) * 0.012;

          return normalize(baseNormal + macroPerturb + mesoPerturb + microPerturb);
        }

        // Keep the baked region and its fitted mean direction. A small continuous
        // tangent field breaks up simultaneous flat flashes without inventing new
        // colour locations or sampling across unrelated UV islands.
        vec3 opalBakedOrientation(vec2 uv, vec3 localPos, vec3 surfaceNormal) {
          vec3 bakedDir = texture2D(uDomainMap, uv).rgb * 2.0 - 1.0;
          float bakedLen = length(bakedDir);
          vec3 baseDirection = bakedLen > 0.2 ? bakedDir / bakedLen : normalize(surfaceNormal);
          vec3 organicDirection = opalOrientationField(localPos, baseDirection);
          return normalize(mix(baseDirection, organicDirection, 0.65));
        }

        vec3 opalFilteredPotential(vec2 uv) {
          // One texel footprint rounds sampling edges; keep the centre dominant
          // so the measured mask does not spread into the surrounding matrix.
          vec3 centre = texture2D(uPreciousOpalMask, uv).rgb;
          vec3 neighbours = texture2D(uPreciousOpalMask, uv + vec2(uFlashTexelSize.x, 0.0)).rgb
            + texture2D(uPreciousOpalMask, uv - vec2(uFlashTexelSize.x, 0.0)).rgb
            + texture2D(uPreciousOpalMask, uv + vec2(0.0, uFlashTexelSize.y)).rgb
            + texture2D(uPreciousOpalMask, uv - vec2(0.0, uFlashTexelSize.y)).rgb;
          return mix(centre, neighbours * 0.25, 0.35) * smoothstep(0.02, 0.10, max(centre.r, centre.g));
        }

        // Spatially correlated continuous silica sphere lattice spacing variation (delta d < 0.05nm/pixel)
        float opalSpacingField(vec3 localPos) {
          vec3 wp = opalDomainWarp(localPos * 6.0);
          return opalNoise3D(wp * 3.5);
        }

        vec3 spectralDiffractionRGB(float wl) {
          wl = clamp(wl, 380.0, 700.0);
          float r = 0.0, g = 0.0, b = 0.0;
          if (wl < 440.0) { r = -(wl - 440.0) / 60.0; b = 1.0; }
          else if (wl < 490.0) { g = (wl - 440.0) / 50.0; b = 1.0; }
          else if (wl < 510.0) { g = 1.0; b = -(wl - 510.0) / 20.0; }
          else if (wl < 580.0) { r = (wl - 510.0) / 70.0; g = 1.0; }
          else if (wl < 645.0) { r = 1.0; g = -(wl - 645.0) / 65.0; }
          else { r = 1.0; }
          float factor = 1.0;
          if (wl < 420.0) factor = 0.35 + 0.65 * (wl - 380.0) / 40.0;
          else if (wl > 650.0) factor = 0.35 + 0.65 * (700.0 - wl) / 50.0;
          return vec3(r, g, b) * factor;
        }

        // =========================================================================
        // --- DIRECTIVE 16: FORENSIC VIDEO-DERIVED OCCURRENCE MASK ENGINE ---
        // Defines the physical silica seam path, widths, and geological boundaries
        // completely independent of the GLB albedo texture.
        // =========================================================================

        // Point-to-line-segment Euclidean distance in 2D specimen space (X, Y)
        float opalDistToSegment2D(vec2 p, vec2 a, vec2 b) {
          vec2 ba = b - a;
          vec2 pa = p - a;
          float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
          return length(pa - ba * h);
        }

        // Computes the authoritative precious opal occurrence mask [0.0 - 1.0]
        // and regional domain classification in NORMALIZED SPECIMEN SPACE [-1.0, +1.0]^3:
        // X = -1 (left) to +1 (right)
        // Y = -1 (base) to +1 (top crest)
        // Z = -1 (back) to +1 (front facet)
        void opalEvaluateOccurrence(
          vec3 localPos, 
          vec3 localNormal, 
          out float outPreciousMask, 
          out float outGreenDomain, 
          out float outBlueDomain
        ) {
          // Normalized Specimen Coordinate System [-1, +1]^3
          vec3 specimenPos = clamp(((localPos - uLocalBoundsMin) / (uLocalBoundsMax - uLocalBoundsMin)) * 2.0 - 1.0, -1.0, 1.0);

          // Domain warp for organic geological boundaries
          vec3 wp = opalDomainWarp(specimenPos * 6.0);
          float geoJitter = (opalNoise3D(wp * 4.5) * 0.015) + (opalNoise3D(specimenPos * 24.0) * 0.006);

          // Front-facing depth envelope: precious facets are on front face (Z > 0.0 in specimen space)
          float specimenFrontDepth = dot(specimenPos, normalize(uSpecimenFrontLocal));
          float depthEnvelope = smoothstep(0.0, 0.35, specimenFrontDepth);

          // -------------------------------------------------------------------------
          // 1. DOMAIN A — PRIMARY GREEN LODE (Right-central facet & right flank)
          // Seam traversing right flank and right-central facet in specimen space
          // -------------------------------------------------------------------------
          vec2 G0 = vec2(0.15, -0.25); // Lower-right matrix entry
          vec2 G1 = vec2(0.35, 0.05);  // Right-central lower wedge
          vec2 G2 = vec2(0.55, 0.35);  // Primary emerald facet core
          vec2 G3 = vec2(0.65, 0.60);  // Right flank crest
          vec2 G4 = vec2(0.50, 0.78);  // Upper right flank taper

          float dG01 = opalDistToSegment2D(specimenPos.xy, G0, G1);
          float dG12 = opalDistToSegment2D(specimenPos.xy, G1, G2);
          float dG23 = opalDistToSegment2D(specimenPos.xy, G2, G3);
          float dG34 = opalDistToSegment2D(specimenPos.xy, G3, G4);

          // Vein widths in normalized specimen space [-1, 1]
          float sG01 = smoothstep(0.20, 0.06, dG01 + geoJitter);
          float sG12 = smoothstep(0.24, 0.07, dG12 + geoJitter);
          float sG23 = smoothstep(0.25, 0.07, dG23 + geoJitter);
          float sG34 = smoothstep(0.18, 0.05, dG34 + geoJitter);

          float greenLodeRawXY = max(max(sG01, sG12), max(sG23, sG34));
          float greenLodeRaw = greenLodeRawXY * depthEnvelope;

          // -------------------------------------------------------------------------
          // 2. DOMAIN B — COBALT / VIOLET SHOULDER (Upper-left shoulder / bevel)
          // Spatially distinct from green lode, angled bevel orientation
          // -------------------------------------------------------------------------
          vec2 B0 = vec2(-0.45, 0.20); // Lower-left shoulder transition
          vec2 B1 = vec2(-0.30, 0.50); // Cobalt shoulder core
          vec2 B2 = vec2(-0.15, 0.72); // Upper shoulder crest

          float dB01 = opalDistToSegment2D(specimenPos.xy, B0, B1);
          float dB12 = opalDistToSegment2D(specimenPos.xy, B1, B2);

          float sB01 = smoothstep(0.18, 0.06, dB01 + geoJitter);
          float sB12 = smoothstep(0.20, 0.06, dB12 + geoJitter);

          float blueShoulderRawXY = max(sB01, sB12);
          float blueShoulderRaw = blueShoulderRawXY * depthEnvelope;

          // -------------------------------------------------------------------------
          // 3. CENTRAL MATRIX EXCLUSION (Dark notch observed between the two domains)
          // Physical potch/host sandstone notch interrupting upper-central area
          // -------------------------------------------------------------------------
          vec2 notchPos = vec2(0.05, 0.55);
          float notchDist = length(specimenPos.xy - notchPos);
          float matrixPass = smoothstep(0.10, 0.22, notchDist + geoJitter * 0.5);

          // -------------------------------------------------------------------------
          // 4. ORIENTATION & BOUNDARY EXCLUSIONS
          // - Reverse / back face: non-diffractive (normal facing away from front facet)
          // - Lower base (Y < -0.35): non-diffractive finger-grip host matrix
          // - Left flank base (X < -0.50): non-diffractive host matrix
          // -------------------------------------------------------------------------
          float frontFacing = dot(normalize(localNormal), normalize(uSpecimenFrontLocal));
          float frontFaceLock = smoothstep(-0.10, 0.20, frontFacing);
          float baseCutoff = smoothstep(-0.45, -0.25, specimenPos.y);
          float leftBaseCutoff = smoothstep(-0.60, -0.40, specimenPos.x);

          // Gate combinations for Green
          float greenMatrixPass = greenLodeRaw * matrixPass;
          float greenFrontFace = greenLodeRaw * frontFaceLock;
          float greenBaseCutoff = greenLodeRaw * baseCutoff;
          float greenLeftBaseCutoff = greenLodeRaw * leftBaseCutoff;
          float activeGreen = greenLodeRaw * matrixPass * frontFaceLock * baseCutoff * leftBaseCutoff;

          // Gate combinations for Blue
          float blueMatrixPass = blueShoulderRaw * matrixPass;
          float blueFrontFace = blueShoulderRaw * frontFaceLock;
          float blueBaseCutoff = blueShoulderRaw * baseCutoff;
          float blueLeftBaseCutoff = blueShoulderRaw * leftBaseCutoff;
          float activeBlue = blueShoulderRaw * matrixPass * frontFaceLock * baseCutoff * leftBaseCutoff;

          // EXPOSE DIAGNOSTICS FOR 17E
          g_testGreenLodeRawXY = greenLodeRawXY;
          g_testDepthEnvelope = depthEnvelope;
          g_testFrontFaceLock = frontFaceLock;
          g_testSpecimenPosZ = specimenFrontDepth;

          // Assign Forensic Isolation Test Variables (Directive 17B)
          g_testGreenLodeRaw = greenLodeRaw;
          g_testBlueShoulderRaw = blueShoulderRaw;
          g_testGreenMatrixPass = greenMatrixPass;
          g_testGreenFrontFaceLock = greenFrontFace;
          g_testGreenBaseCutoff = greenBaseCutoff;
          g_testGreenLeftBaseCutoff = greenLeftBaseCutoff;
          g_testGreenAllGates = activeGreen;

          g_testBlueMatrixPass = blueMatrixPass;
          g_testBlueFrontFaceLock = blueFrontFace;
          g_testBlueBaseCutoff = blueBaseCutoff;
          g_testBlueLeftBaseCutoff = blueLeftBaseCutoff;
          g_testBlueAllGates = activeBlue;

          // -------------------------------------------------------------------------
          // 5. TOTAL PRECIOUS OPAL OCCURRENCE & SPECTRAL DOMAIN CLASSIFICATION
          // -------------------------------------------------------------------------
          float totalOccurrence = clamp(max(activeGreen, activeBlue), 0.0, 1.0);

          float blueWeight = 0.0;
          if (totalOccurrence > 0.001) {
            blueWeight = clamp(activeBlue / (activeGreen + activeBlue + 0.0001), 0.0, 1.0);
          }
          float greenWeight = clamp(1.0 - blueWeight, 0.0, 1.0);

          outPreciousMask = totalOccurrence;
          outGreenDomain = totalOccurrence * greenWeight;
          outBlueDomain = totalOccurrence * blueWeight;
          
          g_testOutGreenDomain = outGreenDomain;
          g_testOutBlueDomain = outBlueDomain;
        }
        `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #if defined( USE_MAP )
          // UNIFIED PRECIOUS OPAL OCCURRENCE & DOMAIN CLASSIFICATION
          // Completely decoupled from the GLB texture albedo green coloration
          if (uHasPreciousOpalMask) {
            // Baked from the reference video: where, on the real stone, green
            // (R) and blue/violet (G) play-of-colour was actually seen.
            vec3 flashPotential = opalFilteredPotential(vMapUv);
            // Fine object-space variation restores organic internal detail to the
            // smoothed map. It is fixed in the stone; it never scrolls with time.
            float organicDensity = 0.75 + 0.35 * smoothstep(-0.22, 0.22, opalFBM(vOpalLocalPos * 23.0));
            flashPotential *= organicDensity;
            g_greenFireMask = smoothstep(0.10, 0.62, flashPotential.r);
            g_blueFireMask  = smoothstep(0.10, 0.62, flashPotential.g) * (1.0 - 0.8 * g_greenFireMask);
            g_preciousOpalMask = max(g_greenFireMask, g_blueFireMask);
          } else {
            float tempPrecious = 0.0;
            float tempGreen = 0.0;
            float tempBlue = 0.0;
            opalEvaluateOccurrence(
              vOpalLocalPos, 
              vOpalLocalNormal, 
              tempPrecious, 
              tempGreen, 
              tempBlue
            );
            g_preciousOpalMask = tempPrecious;
            g_greenFireMask = tempGreen;
            g_blueFireMask = tempBlue;
          }
        #else
          // Procedural fallback for geometry testing
          float distToSeam = length(vOpalLocalPos - uOpalCenter);
          float isOpal = ${isOpalSeam ? '1.0' : '0.0'};
          float seamWeight = max(isOpal, smoothstep(uOpalRadius, uOpalRadius * 0.4, distToSeam));
          if (seamWeight > 0.01) {
            float pPattern = sin(vOpalLocalPos.x * 6.5 + vOpalLocalPos.z * 5.2);
            g_preciousOpalMask = seamWeight;
            g_greenFireMask = seamWeight * smoothstep(0.1, 0.5, pPattern);
            g_blueFireMask = seamWeight * smoothstep(0.1, 0.5, -pPattern);
          }
        #endif

        g_totalFireMask = clamp(g_greenFireMask + g_blueFireMask, 0.0, 1.0);

        // Neutralise and darken the underlying potch in verified precious opal regions
        #if defined( USE_MAP )
          float linearLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          // Substrate potch tone: desaturated dark ironstone/potch background (30% luma) providing high optical contrast
          vec3 linearNeutral = vec3(linearLuma * 0.32, linearLuma * 0.30, linearLuma * 0.28);
          if (uDebugMode != 0 && uDebugMode != 1 && uDebugMode != 2) {
            if (uHasPreciousOpalMask) {
              // DE-BAKE. The scan's texture has the green of the video baked into it
              // (the photos were taken with the flash on). Keep its light/dark detail,
              // but replace its colour with the real stone's plain warm-grey body, so the
              // only colour left on the stone is the colour the shader makes.
              float bodyDetail = pow(clamp(linearLuma / 0.055, 0.15, 3.0), 0.55);
              vec3 stoneBody = vec3(0.165, 0.146, 0.126) * bodyDetail;
              // opal-bearing areas sit on a darker, cooler potch
              vec3 opalPotch = stoneBody * vec3(0.62, 0.66, 0.76);
              diffuseColor.rgb = mix(stoneBody, opalPotch, g_totalFireMask);
            } else {
              diffuseColor.rgb = mix(diffuseColor.rgb, linearNeutral, g_totalFireMask * 0.92);
            }
          }
        #endif
        `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <tonemapping_fragment>',
        `// SPECIMEN-DRIVEN COMPUTATIONAL OPTICAL MODEL (LINEAR RADIANCE INTEGRATION)
        // Calibrated against physical specimen reference video observations:
        // - Primary face: Broad emerald-to-lime green play-of-colour facet with cyan border shifts
        // - Shoulder bevel: Distinct electric cobalt/violet-blue patch that fires on angled upper edge
        // - Ironstone matrix: Non-diffractive host rock with zero colour bleed

        // Mode 5 (Optical Only): Zero base PBR radiance before accumulating optical radiance
        if (uDebugMode == 5) {
          gl_FragColor.rgb = vec3(0.0);
        }

        // Mode 4 (Orientation Field Diagnostic): Visualises smooth continuous normal gradients
        if (uDebugMode == 4) {
          if (g_totalFireMask > 0.005) {
            vec3 localDomainNormal = opalOrientationField(vOpalLocalPos, vOpalLocalNormal);
            #if defined( USE_MAP )
              if (uHasPreciousOpalMask) {
                localDomainNormal = opalBakedOrientation(vMapUv, vOpalLocalPos, vOpalLocalNormal);
              }
            #endif
            vec3 domainNormal = normalize(vOpalWorldRotation * localDomainNormal);
            gl_FragColor.rgb = domainNormal * 0.5 + 0.5;
          } else {
            gl_FragColor.rgb = vOpalWorldNormal * 0.5 + 0.5;
          }
        }

        // Angle-dependent Bragg-Snell diffraction evaluated on known fire regions in linear radiance space
        if (uDebugMode == 5 || uDebugMode == 6) {
          if (g_totalFireMask > 0.005) {
            vec3 L = normalize(uKeyLightDir);
            vec3 V = normalize(cameraPosition - vOpalWorldPos);
            vec3 H = normalize(L + V);

            // CONTINUOUS OPTICAL DOMAIN ORIENTATION FIELD (Developed with Jim Shaw)
            // Evaluates multi-scale continuous 3D domain-warped perturbation in object space.
            // Eliminates all discrete Cartesian polygon/triangle/diamond cell quantisation.
            // Which way do the opal layers face at this point of the stone?
            //  - with the baked images: read straight from the orientation image,
            //    which was fitted so each patch fires where the video shows it firing
            //  - without them: the original procedural orientation field
            vec3 localDomainNormal;
            localDomainNormal = opalOrientationField(vOpalLocalPos, vOpalLocalNormal);
            #if defined( USE_MAP )
              if (uHasPreciousOpalMask) {
                localDomainNormal = opalBakedOrientation(vMapUv, vOpalLocalPos, vOpalLocalNormal);
              }
            #endif
            vec3 domainNormal = normalize(vOpalWorldRotation * localDomainNormal);
            domainNormal = gl_FrontFacing ? domainNormal : -domainNormal;

            float cosThetaI = clamp(dot(domainNormal, L), 0.0, 1.0);
            float cosThetaV = clamp(dot(domainNormal, V), 0.0, 1.0);
            float cosHalf = clamp(dot(domainNormal, H), 0.0, 1.0);

            if (cosThetaI > 0.01 && cosThetaV > 0.01) {
              // Bragg: wavelength = 2 d sqrt(n^2 - sin^2(theta)). Smaller angle -> longer
              // wavelength, larger angle -> shifts toward blue, as on a real opal.
              float sinThetaSq = 1.0 - cosThetaI * cosThetaI;
              float rootTerm = max(0.0, uNSilica * uNSilica - sinThetaSq);

              // Spatially correlated continuous lattice parameter variation
              float spacingShift = opalSpacingField(vOpalLocalPos);
              float dGreen = uDGreen + spacingShift * 5.0;
              float dBlue = uDBlue + spacingShift * 4.5;
              float lambdaGreen = 2.0 * dGreen * sqrt(rootTerm);
              float lambdaBlue = 2.0 * dBlue * sqrt(rootTerm);

              vec3 spectralGreen = spectralDiffractionRGB(lambdaGreen);
              vec3 spectralBlue = spectralDiffractionRGB(lambdaBlue);

              // Flash profile: a broad shoulder plus a sharp core. It fades out over roughly
              // 25-35 degrees of turning, which is what the video shows. The same function is
              // used to bake the orientation image - keep them in step.
              float lobe = 0.15 * pow(cosHalf, 10.0) + 0.30 * pow(cosHalf, 30.0) + 0.55 * pow(cosHalf, 80.0);
              float flashFactor = lobe * cosThetaI * uFlashGain * uKeyLightStrength;

              // Material reflected play-of-colour (additive strictly to stone surface in linear space)
              vec3 greenFire = spectralGreen * (flashFactor * g_greenFireMask);
              vec3 blueFire = spectralBlue * (flashFactor * g_blueFireMask);
              vec3 totalFire = greenFire + blueFire;

              // COLOUR-OVER-SPECULAR REPLACEMENT:
              // When diffraction fires at direct specular alignment (high cosHalf / flashFactor),
              // the uncoloured broadband white specular reflection is replaced by the resonant spectral radiance,
              // matching physical wave-optics interference where reflected energy is filtered into the Bragg band.
              if (uDebugMode == 6) {
                float specularSuppression = clamp(flashFactor * g_totalFireMask * 0.85, 0.0, 0.90);
                // Suppress white specular glare under the flash so the emerald/cobalt radiance dominates
                gl_FragColor.rgb *= (1.0 - specularSuppression);
              }

              // Held back and composited after tone mapping (below) so it stays a pure colour
              g_opalFire = totalFire;
            }
          }
        }

        #include <tonemapping_fragment>

        // The play of colour is light the stone gives back, not paint on it. Add it after tone
        // mapping (still linear) so ACES does not wash saturated greens and blues toward mint
        // or white. A soft shoulder stops hard clipping at the brightest flash.
        {
          float fireMax = max(max(g_opalFire.r, g_opalFire.g), max(g_opalFire.b, 1e-5));
          vec3 fireHue = pow(g_opalFire / fireMax, vec3(1.35));
          gl_FragColor.rgb += fireHue * (1.0 - exp(-1.6 * fireMax));
        }`
      );

      // The scan's material maps describe a shiny, metallic-looking surface. The real
      // stone is a matte, waxy grey ironstone with a soft sheen; the colour is the opal's job.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        if (uHasPreciousOpalMask) { roughnessFactor = max(roughnessFactor, 0.62); }
        `
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        if (uHasPreciousOpalMask) { metalnessFactor = 0.0; }
        `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>

        // Diagnostic Mode 1: PRECIOUS OPAL MASK (Scalar Grayscale: White = Permitted, Black = Host Matrix, Grey = Transition)
        if (uDebugMode == 1) {
          gl_FragColor = vec4(vec3(g_preciousOpalMask), 1.0);
        }

        // Diagnostic Mode 2: MASK OVERLAY (High-contrast white contour over original GLB texture for physical calibration)
        if (uDebugMode == 2) {
          vec3 overlayTint = vec3(1.0, 1.0, 1.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, overlayTint, g_preciousOpalMask * 0.85);
        }

        // Diagnostic Mode 7: FORCE MASK COLOUR (Test 2 - Bypasses all optical equations; direct green/blue on masks)
        if (uDebugMode == 7) {
          vec3 forceColour = vec3(0.0, 4.0, 0.2) * g_greenFireMask + vec3(0.15, 0.35, 4.0) * g_blueFireMask;
          gl_FragColor = vec4(forceColour, 1.0);
        }

        // Diagnostic Mode 8: FORCE FULL GREEN (Test 3 - Bypasses mask and physics; turns all fragments bright green)
        if (uDebugMode == 8) {
          gl_FragColor = vec4(0.0, 4.0, 0.2, 1.0);
        }

        // Diagnostic Mode 9: FORCED RESONANCE (Test 4 - Bragg output on masks, bypassing geometry orientation)
        if (uDebugMode == 9) {
          float lambdaGreen = 530.0;
          float lambdaBlue = 460.0;
          vec3 specG = spectralDiffractionRGB(lambdaGreen);
          vec3 specB = spectralDiffractionRGB(lambdaBlue);
          vec3 forcedRes = (specG * g_greenFireMask * 2.8) + (specB * g_blueFireMask * 2.8);
          gl_FragColor = vec4(forcedRes, 1.0);
        }

        // Diagnostic Mode 10: FLASH FACTOR (Test 5 - Grayscale angular response across specimen)
        if (uDebugMode == 10) {
          vec3 L = normalize(uKeyLightDir);
          vec3 V = normalize(cameraPosition - vOpalWorldPos);
          vec3 H = normalize(L + V);
          vec3 localDomainNormal = opalOrientationField(vOpalLocalPos, vOpalLocalNormal);
          vec3 domainNormal = normalize(vOpalWorldRotation * localDomainNormal);
          float cosThetaI = clamp(dot(domainNormal, L), 0.0, 1.0);
          float cosThetaV = clamp(dot(domainNormal, V), 0.0, 1.0);
          float cosHalf = clamp(dot(domainNormal, H), 0.0, 1.0);
          float broadResonance = pow(cosHalf, 12.0) * 1.8;
          float coreResonance = pow(cosHalf, 32.0) * 4.2;
          float peakResonance = pow(cosHalf, 68.0) * 5.5;
          float braggResonance = broadResonance + coreResonance + peakResonance;
          float obliqueGleam = pow(1.0 - cosThetaV, 3.5) * pow(cosThetaI, 1.8) * 0.25;
          float flashFactor = (braggResonance + obliqueGleam) * cosThetaI;
          gl_FragColor = vec4(vec3(clamp(flashFactor * 0.15, 0.0, 1.0)), 1.0);
        }

        // Diagnostic Mode 11: TEST A — RAW GREEN RIBBON ONLY (No gates, direct white)
        if (uDebugMode == 11) {
          gl_FragColor = vec4(vec3(g_testGreenLodeRaw * 3.0), 1.0);
        }

        // Diagnostic Mode 12: TEST B — RAW BLUE SHOULDER ONLY (No gates, direct white)
        if (uDebugMode == 12) {
          gl_FragColor = vec4(vec3(g_testBlueShoulderRaw * 3.0), 1.0);
        }

        // Diagnostic Mode 13: TEST C — GREEN * MATRIX PASS (Excludes notch/pocket)
        if (uDebugMode == 13) {
          gl_FragColor = vec4(vec3(g_testGreenMatrixPass * 3.0), 1.0);
        }

        // Diagnostic Mode 14: TEST D — GREEN * FRONT FACE LOCK (Excludes reverse face)
        if (uDebugMode == 14) {
          gl_FragColor = vec4(vec3(g_testGreenFrontFaceLock * 3.0), 1.0);
        }

        // Diagnostic Mode 15: TEST E — GREEN * BASE CUTOFF (Excludes finger grip base)
        if (uDebugMode == 15) {
          gl_FragColor = vec4(vec3(g_testGreenBaseCutoff * 3.0), 1.0);
        }

        // Diagnostic Mode 16: TEST F — GREEN * LEFT BASE CUTOFF (Excludes left matrix)
        if (uDebugMode == 16) {
          gl_FragColor = vec4(vec3(g_testGreenLeftBaseCutoff * 3.0), 1.0);
        }

        // Diagnostic Mode 17: TEST G — GREEN * ALL GATES COMBINED (Active green domain)
        if (uDebugMode == 17) {
          gl_FragColor = vec4(vec3(g_testGreenAllGates * 3.0), 1.0);
        }

        // Diagnostic Mode 18: TEST H — BLUE * MATRIX PASS (Excludes notch/pocket)
        if (uDebugMode == 18) {
          gl_FragColor = vec4(vec3(g_testBlueMatrixPass * 3.0), 1.0);
        }

        // Diagnostic Mode 19: TEST I — BLUE * FRONT FACE LOCK (Excludes reverse face)
        if (uDebugMode == 19) {
          gl_FragColor = vec4(vec3(g_testBlueFrontFaceLock * 3.0), 1.0);
        }

        // Diagnostic Mode 20: TEST J — BLUE * BASE CUTOFF (Excludes finger grip base)
        if (uDebugMode == 20) {
          gl_FragColor = vec4(vec3(g_testBlueBaseCutoff * 3.0), 1.0);
        }

        // Diagnostic Mode 21: TEST K — BLUE * LEFT BASE CUTOFF (Excludes left matrix)
        if (uDebugMode == 21) {
          gl_FragColor = vec4(vec3(g_testBlueLeftBaseCutoff * 3.0), 1.0);
        }

        // Diagnostic Mode 22: TEST L — BLUE * ALL GATES COMBINED (Active blue domain)
        if (uDebugMode == 22) {
          gl_FragColor = vec4(vec3(g_testBlueAllGates * 3.0), 1.0);
        }

        // Diagnostic Mode 23: TEST M — RENDER outGreenDomain DIRECTLY
        if (uDebugMode == 23) {
          gl_FragColor = vec4(vec3(g_testOutGreenDomain * 3.0), 1.0);
        }

        // Diagnostic Mode 24: TEST N — RENDER outBlueDomain DIRECTLY
        if (uDebugMode == 24) {
          gl_FragColor = vec4(vec3(g_testOutBlueDomain * 3.0), 1.0);
        }

        // Diagnostic Mode 25: TEST O — RENDER GLOBAL g_greenFireMask DIRECTLY
        if (uDebugMode == 25) {
          gl_FragColor = vec4(vec3(g_greenFireMask * 3.0), 1.0);
        }
        
        // Diagnostic Mode 26: TEST P — RENDER GLOBAL g_blueFireMask DIRECTLY
        if (uDebugMode == 26) {
          gl_FragColor = vec4(vec3(g_blueFireMask * 3.0), 1.0);
        }

        
        // Diagnostic Mode 28: TEST R — TOTAL MASKED FLASH
        if (uDebugMode == 28) {
          vec3 L = normalize(uKeyLightDir);
          vec3 V = normalize(cameraPosition - vOpalWorldPos);
          vec3 H = normalize(L + V);
          vec3 localDomainNormal = opalOrientationField(vOpalLocalPos, vOpalLocalNormal);
          vec3 domainNormal = normalize(vOpalWorldRotation * localDomainNormal);
          float cosHalf = clamp(dot(domainNormal, H), 0.0, 1.0);
          float flashFactor = pow(cosHalf, 12.0) * 1.8;
          float maskedFlash = flashFactor * g_totalFireMask;
          gl_FragColor = vec4(vec3(clamp(maskedFlash * 2.0, 0.0, 1.0)), 1.0);
        }

        // Diagnostic Mode 29: TEST S — GREEN MASKED FLASH
        if (uDebugMode == 29) {
          vec3 L = normalize(uKeyLightDir);
          vec3 V = normalize(cameraPosition - vOpalWorldPos);
          vec3 H = normalize(L + V);
          vec3 localDomainNormal = opalOrientationField(vOpalLocalPos, vOpalLocalNormal);
          vec3 domainNormal = normalize(vOpalWorldRotation * localDomainNormal);
          float cosHalf = clamp(dot(domainNormal, H), 0.0, 1.0);
          float flashFactor = pow(cosHalf, 12.0) * 1.8;
          float maskedFlash = flashFactor * g_greenFireMask;
          gl_FragColor = vec4(vec3(clamp(maskedFlash * 2.0, 0.0, 1.0)), 1.0);
        }

        // Diagnostic Mode 30: TEST T — BLUE MASKED FLASH
        if (uDebugMode == 30) {
          vec3 L = normalize(uKeyLightDir);
          vec3 V = normalize(cameraPosition - vOpalWorldPos);
          vec3 H = normalize(L + V);
          vec3 localDomainNormal = opalOrientationField(vOpalLocalPos, vOpalLocalNormal);
          vec3 domainNormal = normalize(vOpalWorldRotation * localDomainNormal);
          float cosHalf = clamp(dot(domainNormal, H), 0.0, 1.0);
          float flashFactor = pow(cosHalf, 12.0) * 1.8;
          float maskedFlash = flashFactor * g_blueFireMask;
          gl_FragColor = vec4(vec3(clamp(maskedFlash * 2.0, 0.0, 1.0)), 1.0);
        }

        
        // Diagnostic Mode 31: TEST U — MASKED cosThetaI
        if (uDebugMode == 31) {
          vec3 L = normalize(uKeyLightDir);
          vec3 localDomainNormal = opalOrientationField(vOpalLocalPos, vOpalLocalNormal);
          vec3 domainNormal = normalize(vOpalWorldRotation * localDomainNormal);
          domainNormal = gl_FrontFacing ? domainNormal : -domainNormal;
          float cosThetaI = clamp(dot(domainNormal, L), 0.0, 1.0);
          float test = cosThetaI * g_totalFireMask;
          gl_FragColor = vec4(vec3(test), 1.0);
        }

        // Diagnostic Mode 32: TEST V — MASKED cosThetaV
        if (uDebugMode == 32) {
          vec3 V = normalize(cameraPosition - vOpalWorldPos);
          vec3 localDomainNormal = opalOrientationField(vOpalLocalPos, vOpalLocalNormal);
          vec3 domainNormal = normalize(vOpalWorldRotation * localDomainNormal);
          domainNormal = gl_FrontFacing ? domainNormal : -domainNormal;
          float cosThetaV = clamp(dot(domainNormal, V), 0.0, 1.0);
          float test = cosThetaV * g_totalFireMask;
          gl_FragColor = vec4(vec3(test), 1.0);
        }

        // Diagnostic Mode 33: TEST W — OPTICAL VALIDITY GATE
        if (uDebugMode == 33) {
          vec3 L = normalize(uKeyLightDir);
          vec3 V = normalize(cameraPosition - vOpalWorldPos);
          vec3 localDomainNormal = opalOrientationField(vOpalLocalPos, vOpalLocalNormal);
          vec3 domainNormal = normalize(vOpalWorldRotation * localDomainNormal);
          domainNormal = gl_FrontFacing ? domainNormal : -domainNormal;
          float cosThetaI = clamp(dot(domainNormal, L), 0.0, 1.0);
          float cosThetaV = clamp(dot(domainNormal, V), 0.0, 1.0);
          float valid = (cosThetaI > 0.01 && cosThetaV > 0.01) ? 1.0 : 0.0;
          gl_FragColor = vec4(vec3(valid * g_totalFireMask), 1.0);
        }

        // Diagnostic Mode 34: TEST X — PRODUCTION SPECTRUM WITHOUT VIEW GATE
        if (uDebugMode == 34) {
          vec3 L = normalize(uKeyLightDir);
          vec3 V = normalize(cameraPosition - vOpalWorldPos);
          vec3 H = normalize(L + V);
          vec3 localDomainNormal = opalOrientationField(vOpalLocalPos, vOpalLocalNormal);
          vec3 domainNormal = normalize(vOpalWorldRotation * localDomainNormal);
          domainNormal = gl_FrontFacing ? domainNormal : -domainNormal;
          float cosHalf = clamp(dot(domainNormal, H), 0.0, 1.0);
          float flashFactor = pow(cosHalf, 12.0) * 1.8;
          float nSilica = 1.450;
          float dGreen = 221.0 + opalSpacingField(vOpalLocalPos) * 6.5;
          float dBlue = 188.0 + opalSpacingField(vOpalLocalPos) * 5.5;
          float cosThetaI = clamp(dot(domainNormal, L), 0.0, 1.0);
          float shiftFactor = sqrt(max(0.0, nSilica * nSilica - 1.0 + cosThetaI * cosThetaI));
          float lambdaGreen = 2.0 * dGreen * shiftFactor;
          float lambdaBlue = 2.0 * dBlue * shiftFactor;
          vec3 spectralGreen = spectralDiffractionRGB(lambdaGreen);
          vec3 spectralBlue = spectralDiffractionRGB(lambdaBlue);
          vec3 testFire = spectralGreen * flashFactor * g_greenFireMask + spectralBlue * flashFactor * g_blueFireMask;
          gl_FragColor = vec4(testFire, 1.0);
        }

        // Diagnostic Mode 35: TEST Y — PRODUCTION SPECTRAL RGB
        if (uDebugMode == 35) {
          vec3 L = normalize(uKeyLightDir);
          vec3 localDomainNormal = opalOrientationField(vOpalLocalPos, vOpalLocalNormal);
          vec3 domainNormal = normalize(vOpalWorldRotation * localDomainNormal);
          domainNormal = gl_FrontFacing ? domainNormal : -domainNormal;
          float cosThetaI = clamp(dot(domainNormal, L), 0.0, 1.0);
          float nSilica = 1.450;
          float dGreen = 221.0 + opalSpacingField(vOpalLocalPos) * 6.5;
          float dBlue = 188.0 + opalSpacingField(vOpalLocalPos) * 5.5;
          float shiftFactor = sqrt(max(0.0, nSilica * nSilica - 1.0 + cosThetaI * cosThetaI));
          float lambdaGreen = 2.0 * dGreen * shiftFactor;
          float lambdaBlue = 2.0 * dBlue * shiftFactor;
          vec3 spectralGreen = spectralDiffractionRGB(lambdaGreen);
          vec3 spectralBlue = spectralDiffractionRGB(lambdaBlue);
          vec3 spectralTest = spectralGreen * g_greenFireMask + spectralBlue * g_blueFireMask;
          gl_FragColor = vec4(spectralTest * 2.0, 1.0);
        }

        // Diagnostic Mode 36: 17E TEST 1 - RAW GREEN WITH NO Z OR NORMAL GATING
        if (uDebugMode == 36) {
          gl_FragColor = vec4(vec3(g_testGreenLodeRawXY), 1.0);
        }

        // Diagnostic Mode 37: 17E TEST 2 - DEPTH ENVELOPE ONLY
        if (uDebugMode == 37) {
          gl_FragColor = vec4(vec3(g_testGreenLodeRawXY * g_testDepthEnvelope), 1.0);
        }

        // Diagnostic Mode 38: 17E TEST 3 - FRONT FACE LOCK ONLY
        if (uDebugMode == 38) {
          gl_FragColor = vec4(vec3(g_testGreenLodeRawXY * g_testFrontFaceLock), 1.0);
        }

        // Diagnostic Mode 39: 17E TEST 4 - VISUALISE specimenPos.z
        if (uDebugMode == 39) {
          float zVis = g_testSpecimenPosZ * 0.5 + 0.5;
          gl_FragColor = vec4(vec3(zVis), 1.0);
        }

        // Diagnostic Mode 40: 17F TEST 1 - PHYSICAL FRONT DEPTH
        if (uDebugMode == 40) {
          gl_FragColor = vec4(vec3(g_testSpecimenPosZ > 0.0 ? 1.0 : 0.0), 1.0);
        }

        // Diagnostic Mode 41: 17F TEST 2 - PHYSICAL FRONT NORMAL
        if (uDebugMode == 41) {
          float frontFacing = dot(normalize(vOpalLocalNormal), normalize(uSpecimenFrontLocal));
          gl_FragColor = vec4(vec3(frontFacing > 0.0 ? 1.0 : 0.0), 1.0);
        }

        // Diagnostic Mode 42: 17F TEST 3 - FRONT LIGHT EXPOSURE
        if (uDebugMode == 42) {
          vec3 L = normalize(uKeyLightDir);
          vec3 localDomainNormal = opalOrientationField(vOpalLocalPos, vOpalLocalNormal);
          vec3 domainNormal = normalize(vOpalWorldRotation * localDomainNormal);
          vec3 correctedWorldNormal = gl_FrontFacing ? domainNormal : -domainNormal;
          float exposure = max(dot(correctedWorldNormal, L), 0.0);
          gl_FragColor = vec4(vec3(exposure * g_totalFireMask), 1.0);
        }

        // Diagnostic Mode 27: TEST Q — RENDER GLOBAL g_totalFireMask DIRECTLY
        if (uDebugMode == 27) {
          gl_FragColor = vec4(vec3(g_totalFireMask * 3.0), 1.0);
        }`
      );
    };
  }, []);

  const createProceduralSpecimen = useCallback((): THREE.Group => {
    const group = new THREE.Group();
    // 1. Base Sandstone
    const baseGeo = new THREE.DodecahedronGeometry(1.6, 3);
    const pos = baseGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const dist = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const noise1 = Math.sin(vx * 3.2) * Math.cos(vy * 2.8) * Math.sin(vz * 3.5) * 0.18;
      const noise2 = Math.sin(vx * 7.5 + 1.2) * Math.sin(vz * 6.8) * 0.08;
      const flatBottom = vy < -0.8 ? 0.3 : 1.0;
      const scale = 1 + (noise1 + noise2) * (1 / (dist || 1));
      pos.setXYZ(i, vx * scale * 1.35, vy * scale * 0.95 * flatBottom, vz * scale * 0.85);
    }
    baseGeo.computeVertexNormals();
    const matrixMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x181614),
      roughness: 0.88,
      metalness: 0.12,
      flatShading: false,
      side: THREE.DoubleSide,
      clippingPlanes: [],
      clipShadows: true,
    });
    const baseMesh = new THREE.Mesh(baseGeo, matrixMat);
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    group.add(baseMesh);

    // 2. Precious Opal
    const opalSeamGeo = new THREE.SphereGeometry(1.45, 48, 32, 0, Math.PI * 1.3, 0, Math.PI * 0.65);
    const opalPos = opalSeamGeo.attributes.position;
    for (let i = 0; i < opalPos.count; i++) {
      const vx = opalPos.getX(i);
      const vy = opalPos.getY(i);
      const vz = opalPos.getZ(i);
      const n = Math.sin(vx * 4.0) * Math.cos(vz * 4.0) * 0.12;
      opalPos.setXYZ(i, vx * 1.36 + n, (vy * 0.96) + 0.08, vz * 0.88 + n);
    }
    opalSeamGeo.computeVertexNormals();
    const opalMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x1b4332), // Natural Australian green opal matrix tone
      roughness: 0.22,
      metalness: 0.04,
      side: THREE.DoubleSide,
      clippingPlanes: [],
      clipShadows: true,
    });
    applyOpticalDiffractionShader(opalMat, true);
    const seamMesh = new THREE.Mesh(opalSeamGeo, opalMat);
    seamMesh.position.y = 0.2;
    seamMesh.rotation.z = -0.15;
    seamMesh.castShadow = true;
    seamMesh.receiveShadow = true;
    group.add(seamMesh);

    modelMaterialsRef.current = [matrixMat, opalMat];
    return group;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let isDisposed = false;
    // Changing the specimen/maps must not briefly combine the new map with the
    // previous specimen's orientation image.
    hasFlashTexturesUniformRef.current.value = false;
    flashMaskUniformRef.current.value = null;
    domainMapUniformRef.current.value = null;
    const loadedOpticalTextures: THREE.Texture[] = [];
    // False while the viewer is scrolled off-screen or the tab is hidden: the loop keeps
    // ticking but skips all drawing, so a stone further down the page costs no battery.
    let isActive = true;
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 500;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    fitScaleRef.current = fitWidthRef.current ? fitScaleForAspect(width / height) : 1;
    camera.position.set(0, 0, BASE_CAMERA_DISTANCE * fitScaleRef.current);
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch (err) {
      // No WebGL on this device or browser: let the page show the still photo instead.
      console.warn('[opal] WebGL unavailable', err);
      onLoadErrorRef.current?.();
      return;
    }
    // CSS owns the canvas display size so responsive layout changes stay in sync.
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.localClippingEnabled = true;
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 1.4;
    controls.maxDistance = 50.0;
    controls.enablePan = false;
    controls.enableZoom = enableZoomRef.current;
    canvas.style.touchAction = touchActionRef.current;   // OrbitControls sets 'none'; override if asked
    controlsRef.current = controls;

    // Lighting: Controlled Single-Source Optical Illumination
    const ambient = new THREE.AmbientLight(0x403d39, 0.10);
    scene.add(ambient);

    // Primary Directional Key Light (same constant the shader and HUD use)
    const keyLight = new THREE.DirectionalLight(0xfaf8f5, KEY_LIGHT_INTENSITY);
    keyLight.position.copy(KEY_LIGHT_POS);
    scene.add(keyLight);

    // --- PROCEDURAL STRATA LAYER (State 02: Extraction / Mine) ---
    const strataGroup = new THREE.Group();
    strataGroup.visible = false;
    
    // Strata circular rings at varying depths
    const strataDepths = [
      { y: 1.8, radius: 4.5, color: 0x8E8A82, label: 'Regolith 0m' },
      { y: 0.6, radius: 4.2, color: 0x6E6250, label: 'Silcrete Duricrust -4m' },
      { y: 0.0, radius: 3.8, color: 0xC8A97E, label: 'Matrix Sandstone Seam -18m' },
      { y: -1.2, radius: 4.0, color: 0x3A342B, label: 'Bulldog Shale Bed -26m' },
    ];

    strataDepths.forEach((layer) => {
      const ringGeo = new THREE.RingGeometry(layer.radius - 0.02, layer.radius, 64);
      const ringMat = new THREE.MeshBasicMaterial({
        color: layer.color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.35,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = Math.PI / 2;
      ringMesh.position.y = layer.y;
      strataGroup.add(ringMesh);

      // Radial ticks
      const radialGeo = new THREE.BufferGeometry();
      const points: number[] = [];
      for (let i = 0; i < 16; i++) {
        const theta = (i / 16) * Math.PI * 2;
        const inner = layer.radius - 0.3;
        const outer = layer.radius;
        points.push(Math.cos(theta) * inner, layer.y, Math.sin(theta) * inner);
        points.push(Math.cos(theta) * outer, layer.y, Math.sin(theta) * outer);
      }
      radialGeo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      const radialLines = new THREE.LineSegments(
        radialGeo,
        new THREE.LineBasicMaterial({ color: layer.color, transparent: true, opacity: 0.25 })
      );
      strataGroup.add(radialLines);
    });

    // Vertical extraction borehole guideline
    const shaftGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 3, 0),
      new THREE.Vector3(0, -3, 0)
    ]);
    const shaftLine = new THREE.Line(
      shaftGeo,
      new THREE.LineDashedMaterial({ color: 0xC8A97E, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.4 })
    );
    shaftLine.computeLineDistances();
    strataGroup.add(shaftLine);

    scene.add(strataGroup);
    strataGroupRef.current = strataGroup;

    // --- PROCEDURAL TERRITORY SURVEY GRID (State 03: Town / Region) ---
    const territoryGroup = new THREE.Group();
    territoryGroup.visible = false;

    const gridHelper = new THREE.GridHelper(30, 20, 0xC8A97E, 0x33302A);
    gridHelper.position.y = -0.5;
    if (Array.isArray(gridHelper.material)) {
      gridHelper.material.forEach(m => { m.transparent = true; m.opacity = 0.2; });
    } else {
      gridHelper.material.transparent = true;
      gridHelper.material.opacity = 0.2;
    }
    territoryGroup.add(gridHelper);

    // Survey perimeter bounding box
    const boxGeo = new THREE.BoxGeometry(16, 0.1, 16);
    const boxWire = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeo),
      new THREE.LineBasicMaterial({ color: 0xC8A97E, transparent: true, opacity: 0.35 })
    );
    boxWire.position.y = -0.48;
    territoryGroup.add(boxWire);

    scene.add(territoryGroup);
    territoryGroupRef.current = territoryGroup;

    // --- INVESTIGATIVE INQUIRY VISUAL CUES GROUP (THE OPTICAL BENCH) ---
    const inquiryGroup = new THREE.Group();
    
    // 1. Spatial Optical Bench Construction (for Precious Silica Seam)
    const opticalBenchGroup = new THREE.Group();
    opticalBenchGroup.name = 'opticalBench';
    opticalBenchGroup.visible = false;

    // 1a. Incident Light Ray
    const incidentGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const incidentMat = new THREE.LineDashedMaterial({
      color: 0xC8A97E,
      dashSize: 0.08,
      gapSize: 0.04,
      transparent: true,
      opacity: 0.9,
    });
    const incidentLine = new THREE.Line(incidentGeo, incidentMat);
    incidentLine.name = 'incidentLine';
    opticalBenchGroup.add(incidentLine);

    // 1a-arrow. Incident Direction Cone
    const arrowGeo = new THREE.ConeGeometry(0.024, 0.06, 12);
    const incidentConeMat = new THREE.MeshBasicMaterial({ color: 0xC8A97E, transparent: true, opacity: 0.9 });
    const incidentCone = new THREE.Mesh(arrowGeo, incidentConeMat);
    incidentCone.name = 'incidentCone';
    opticalBenchGroup.add(incidentCone);

    // 1b. Surface Normal Indicator
    const normalGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const normalMat = new THREE.LineBasicMaterial({
      color: 0xF5F2ED,
      transparent: true,
      opacity: 0.95,
    });
    const normalLine = new THREE.Line(normalGeo, normalMat);
    normalLine.name = 'normalLine';
    opticalBenchGroup.add(normalLine);

    // 1b-arrow. Surface Normal Arrow
    const normalConeMat = new THREE.MeshBasicMaterial({ color: 0xF5F2ED, transparent: true, opacity: 0.95 });
    const normalCone = new THREE.Mesh(arrowGeo, normalConeMat);
    normalCone.name = 'normalCone';
    opticalBenchGroup.add(normalCone);

    // 1b-bracket. Orthogonal Corner Bracket (Right-angle sign at normal base)
    const bracketGeo = new THREE.BufferGeometry();
    const bracketMat = new THREE.LineBasicMaterial({ color: 0xF5F2ED, transparent: true, opacity: 0.7 });
    const bracketLine = new THREE.Line(bracketGeo, bracketMat);
    bracketLine.name = 'bracketLine';
    opticalBenchGroup.add(bracketLine);

    // 1c. Observer / Line of Sight Ray
    const observerGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const observerMat = new THREE.LineDashedMaterial({
      color: 0x7CA8C4,
      dashSize: 0.08,
      gapSize: 0.04,
      transparent: true,
      opacity: 0.85,
    });
    const observerLine = new THREE.Line(observerGeo, observerMat);
    observerLine.name = 'observerLine';
    opticalBenchGroup.add(observerLine);

    // 1c-arrow. Observer Arrow
    const observerConeMat = new THREE.MeshBasicMaterial({ color: 0x7CA8C4, transparent: true, opacity: 0.85 });
    const observerCone = new THREE.Mesh(arrowGeo, observerConeMat);
    observerCone.name = 'observerCone';
    opticalBenchGroup.add(observerCone);

    // 1d. Specular Bisector / Half-Vector Ray
    const halfVecGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const halfVecMat = new THREE.LineDashedMaterial({
      color: 0xE2D5C3,
      dashSize: 0.05,
      gapSize: 0.05,
      transparent: true,
      opacity: 0.5,
    });
    const halfVecLine = new THREE.Line(halfVecGeo, halfVecMat);
    halfVecLine.name = 'halfVecLine';
    opticalBenchGroup.add(halfVecLine);

    // 1e. Surface Anchor Reticle & Graticule Ring
    const reticleGeo = new THREE.RingGeometry(0.04, 0.052, 32);
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0xC8A97E,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
    });
    const reticleMesh = new THREE.Mesh(reticleGeo, reticleMat);
    reticleMesh.name = 'surfaceReticle';
    opticalBenchGroup.add(reticleMesh);

    // 1e-inner. Crosshair lines in reticle
    const crosshairGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.06, 0, 0), new THREE.Vector3(0.06, 0, 0),
      new THREE.Vector3(0, -0.06, 0), new THREE.Vector3(0, 0.06, 0),
    ]);
    const crosshairMat = new THREE.LineBasicMaterial({ color: 0xC8A97E, transparent: true, opacity: 0.8 });
    const crosshairLine = new THREE.LineSegments(crosshairGeo, crosshairMat);
    crosshairLine.name = 'crosshairLine';
    opticalBenchGroup.add(crosshairLine);

    // 1f. Optical Bench Coordinate Arc
    const arcPointsCount = 28;
    const arcPositions = new Float32Array(arcPointsCount * 3);
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3));
    const arcMat = new THREE.LineBasicMaterial({
      color: 0xC8A97E,
      transparent: true,
      opacity: 0.65,
    });
    const arcLine = new THREE.Line(arcGeo, arcMat);
    arcLine.name = 'angularArc';
    opticalBenchGroup.add(arcLine);

    // 1g. Microstructure Lattice Planes (Active in MODEL state)
    const latticeGroup = new THREE.Group();
    latticeGroup.name = 'latticePlanes';
    latticeGroup.visible = false;
    for (let l = 0; l < 4; l++) {
      const planeGeo = new THREE.RingGeometry(0.02, 0.22, 24);
      const planeMat = new THREE.MeshBasicMaterial({
        color: 0x7CA8C4,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.35 - l * 0.06,
        wireframe: true,
      });
      const planeMesh = new THREE.Mesh(planeGeo, planeMat);
      planeMesh.position.y = -l * 0.06;
      latticeGroup.add(planeMesh);
    }
    opticalBenchGroup.add(latticeGroup);

    inquiryGroup.add(opticalBenchGroup);

    // 2. Matrix Survey Geological Apparatus (for Host Matrix Boundary)
    const matrixSurveyGroup = new THREE.Group();
    matrixSurveyGroup.name = 'matrixSurvey';
    matrixSurveyGroup.visible = false;

    // 2a. Geological Reference Plane Grid (fine wireframe graticule expanding into negative space)
    const gridPlaneGeo = new THREE.PlaneGeometry(3.2, 3.2, 16, 16);
    const gridPlaneWire = new THREE.WireframeGeometry(gridPlaneGeo);
    const gridPlaneMat = new THREE.LineBasicMaterial({
      color: 0x8E8A82,
      transparent: true,
      opacity: 0.3,
    });
    const gridPlaneLine = new THREE.LineSegments(gridPlaneWire, gridPlaneMat);
    gridPlaneLine.name = 'geologicalRefPlane';
    matrixSurveyGroup.add(gridPlaneLine);

    // 2b. Stratigraphic Reference Axis (Sedimentary Dip / Extraction vector)
    const axisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1.35, 0),
    ]);
    const axisMat = new THREE.LineDashedMaterial({
      color: 0xC8A97E,
      dashSize: 0.08,
      gapSize: 0.04,
      transparent: true,
      opacity: 0.85,
    });
    const axisLine = new THREE.Line(axisGeo, axisMat);
    axisLine.name = 'stratigraphicAxis';
    matrixSurveyGroup.add(axisLine);

    // 2b-arrow. Stratigraphic Upward Cone
    const axisConeMat = new THREE.MeshBasicMaterial({ color: 0xC8A97E, transparent: true, opacity: 0.9 });
    const axisCone = new THREE.Mesh(arrowGeo, axisConeMat);
    axisCone.name = 'stratigraphicCone';
    matrixSurveyGroup.add(axisCone);

    // 2c. Interface Surface Reticle & Crosshair (Anchored directly on specimen facet)
    const ifaceReticleGeo = new THREE.RingGeometry(0.045, 0.06, 32);
    const ifaceReticleMat = new THREE.MeshBasicMaterial({
      color: 0x8E8A82,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
    });
    const ifaceReticle = new THREE.Mesh(ifaceReticleGeo, ifaceReticleMat);
    ifaceReticle.name = 'ifaceReticle';
    matrixSurveyGroup.add(ifaceReticle);

    const ifaceCrossGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.08, 0, 0), new THREE.Vector3(0.08, 0, 0),
      new THREE.Vector3(0, -0.08, 0), new THREE.Vector3(0, 0.08, 0),
    ]);
    const ifaceCrossMat = new THREE.LineBasicMaterial({ color: 0x8E8A82, transparent: true, opacity: 0.85 });
    const ifaceCross = new THREE.LineSegments(ifaceCrossGeo, ifaceCrossMat);
    ifaceCross.name = 'ifaceCross';
    matrixSurveyGroup.add(ifaceCross);

    // 2d. Non-destructive Section Frame Slice Indicator
    const sectionFrameGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(2.4, 2.0));
    const sectionFrameMat = new THREE.LineBasicMaterial({
      color: 0xC8A97E,
      transparent: true,
      opacity: 0.75,
    });
    const sectionFrame = new THREE.LineSegments(sectionFrameGeo, sectionFrameMat);
    sectionFrame.name = 'sectionFrame';
    sectionFrame.visible = false;
    matrixSurveyGroup.add(sectionFrame);

    inquiryGroup.add(matrixSurveyGroup);

    // 3. Digital Twin Registration Frame (Custody & Coordinate Datum)
    const regBoxGeo = new THREE.BoxGeometry(2.4, 1.8, 1.6);
    const regBoxEdges = new THREE.EdgesGeometry(regBoxGeo);
    const regBoxMat = new THREE.LineBasicMaterial({
      color: 0xC8A97E,
      transparent: true,
      opacity: 0.35,
    });
    const regBox = new THREE.LineSegments(regBoxEdges, regBoxMat);
    regBox.name = 'custodyBox';
    regBox.visible = false;
    inquiryGroup.add(regBox);

    scene.add(inquiryGroup);

    // Local clipping plane instance
    const localClippingPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // Loader setup
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(dracoDecoderPath || '/solarium/draco/');
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    const attachModelToScene = (modelRoot: THREE.Group) => {
      if (isDisposed) return;
      // Open with the flat face to the camera, flash on - the first frame of the video.
      modelRoot.rotation.set(
        THREE.MathUtils.degToRad(HERO_POSE_DEG.pitch),
        THREE.MathUtils.degToRad(HERO_POSE_DEG.yaw),
        THREE.MathUtils.degToRad(HERO_POSE_DEG.roll)
      );
      modelGroupRef.current = modelRoot;
      scene.add(modelRoot);

      // Wire up orientation setter for calibration rig
      setModelOrientationFnRef.current = (yawDeg: number, pitchDeg: number, rollDeg: number, presetId?: string) => {
        if (!modelGroupRef.current) return;
        if (autoRotateRef.current) {
          autoRotateRef.current = false;
          onInteractionStartRef.current?.();
        }
        modelGroupRef.current.rotation.set(
          THREE.MathUtils.degToRad(pitchDeg),
          THREE.MathUtils.degToRad(yawDeg),
          THREE.MathUtils.degToRad(rollDeg)
        );
        if (presetId) {
          setCalibrationTelemetry(prev => ({ ...prev, activePresetId: presetId }));
        }
      };
    };

    const effectiveModelUrl = modelUrl || '/solarium/models/Matrixtwin_opal.glb';

    // Flash textures sit next to the model: <name>.glb -> <name>_flash.png, <name>_domain.png.
    // Until both arrive the shader falls back to its original procedural masks, so a
    // twin without these files still renders (just without the video-fitted flash).
    {
      const stem = effectiveModelUrl.replace(/\.glb(\?.*)?$/i, '');
      const texLoader = new THREE.TextureLoader();
      const prepare = (tex: THREE.Texture) => {
        loadedOpticalTextures.push(tex);
        tex.flipY = false;                       // glTF UVs: origin top-left
        tex.colorSpace = THREE.NoColorSpace;     // data, not colour
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = 4;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.needsUpdate = true;
      };
      const tryEnable = () => {
        if (flashMaskUniformRef.current.value && domainMapUniformRef.current.value) {
          hasFlashTexturesUniformRef.current.value = true;
        }
      };
      texLoader.load(opticalMaps?.flash ?? `${stem}_flash.png`, (tex) => {
        if (isDisposed) { tex.dispose(); return; }
        prepare(tex);
        flashTexelSizeUniformRef.current.value.set(1 / tex.image.width, 1 / tex.image.height);
        flashMaskUniformRef.current.value = tex; tryEnable();
      }, undefined, () => console.warn('[opal] flash mask not found - using procedural masks'));
      texLoader.load(opticalMaps?.domain ?? `${stem}_domain.png`, (tex) => {
        if (isDisposed) { tex.dispose(); return; }
        prepare(tex); domainMapUniformRef.current.value = tex; tryEnable();
      }, undefined, () => console.warn('[opal] orientation map not found - using procedural orientation'));
    }

    if (effectiveModelUrl) {
      gltfLoader.load(
        effectiveModelUrl,
        (gltf) => {
          if (isDisposed) return;
          const root = gltf.scene;
          const box = new THREE.Box3().setFromObject(root);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          
          const maxDim = Math.max(size.x, size.y, size.z);
          const scaleFactor = 2.4 / (maxDim || 1);
          
          root.position.x = -center.x * scaleFactor;
          root.position.y = -center.y * scaleFactor;
          root.position.z = -center.z * scaleFactor;
          root.scale.setScalar(scaleFactor);
          
          const group = new THREE.Group();
          group.add(root);
          
          const loadedMaterials: THREE.Material[] = [];
          root.traverse((child) => {
            if (child instanceof THREE.Mesh && child.material) {
              const old = child.material;
              
              const cleanMat = new THREE.MeshStandardMaterial({
                color: old.color ? old.color.clone() : new THREE.Color(0xffffff),
                map: old.map || null,
                normalMap: old.normalMap || null,
                roughnessMap: old.roughnessMap || null,
                metalnessMap: old.metalnessMap || null,
                roughness: old.roughness !== undefined ? old.roughness : 0.35,
                metalness: old.metalness !== undefined ? old.metalness : 0.05,
                side: THREE.DoubleSide,
                clippingPlanes: [],
                clipShadows: true,
              });
              applyOpticalDiffractionShader(cleanMat, false);

              child.material = cleanMat;
              loadedMaterials.push(cleanMat);
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          modelMaterialsRef.current = loadedMaterials;
          attachModelToScene(group);
          onReadyRef.current?.();
        },
        undefined,
        (error) => {
          console.error("GLTF Load Error:", error);
          if (proceduralFallbackRef.current) {
            attachModelToScene(createProceduralSpecimen());
          } else {
            onLoadErrorRef.current?.();
          }
        }
      );
    } else {
      attachModelToScene(createProceduralSpecimen());
    }

    let animationFrameId: number;
    const clock = new THREE.Clock();

    // 3 Primary Investigative Regions of Interest on the Specimen
    const FEATURE_POINTS: Record<string, THREE.Vector3> = {
      material: new THREE.Vector3(-0.65, -0.2, 0.45),   // Host Sandstone Bedrock Boundary
      diffraction: new THREE.Vector3(0.35, 0.45, 0.65), // Precious Opal Silica Seam
      custody: new THREE.Vector3(0.1, -0.65, 0.7),      // Planar Cut Reference Base
    };

    // --- OPTICAL INSTRUMENT CAMERA FOCUS & MEMORY CONTROLLER ---
    triggerFocusTransitionRef.current = (featId: string | null) => {
      if (isDisposed || !camera || !controls) return;

      if (featId) {
        // Entering investigation: save observation state baseline if not already captured
        if (!savedObservationRef.current) {
          savedObservationRef.current = {
            position: camera.position.clone(),
            target: controls.target.clone(),
            fov: camera.fov,
            distance: camera.position.distanceTo(controls.target),
          };
        }

        let targetTarget = new THREE.Vector3(0, 0, 0);
        let targetDist = 3.5;
        let targetFov = 31.0;

        if (modelGroupRef.current && FEATURE_POINTS[featId]) {
          const regionLocal = FEATURE_POINTS[featId];
          const regionWorld = regionLocal.clone().applyMatrix4(modelGroupRef.current.matrixWorld);

          if (featId === 'diffraction') {
            targetTarget = regionWorld.clone().multiplyScalar(0.40);
            targetDist = 3.45;
            targetFov = 31.0;
          } else if (featId === 'material') {
            targetTarget = regionWorld.clone().multiplyScalar(0.45);
            targetDist = 3.55;
            targetFov = 31.0;
          } else if (featId === 'custody') {
            targetTarget = regionWorld.clone().multiplyScalar(0.20);
            targetDist = 4.20;
            targetFov = 33.0;
          }
        }

        // View direction from target to current camera position (preserves user's current spatial perspective)
        const dir = camera.position.clone().sub(controls.target).normalize();
        if (dir.lengthSq() < 0.001) dir.set(0, 0, 1);
        const targetPos = targetTarget.clone().add(dir.multiplyScalar(targetDist));

        transitionRef.current = {
          active: true,
          startTime: performance.now(),
          duration: 650, // 650ms precision instrument focus
          startPos: camera.position.clone(),
          targetPos,
          startTarget: controls.target.clone(),
          targetTarget,
          startFov: camera.fov,
          targetFov,
        };
      } else {
        // Exiting investigation: restore observation state
        const saved = savedObservationRef.current;
        const restoreDist = saved ? saved.distance : 4.8;
        const restoreFov = saved ? saved.fov : 35.0;
        const targetTarget = new THREE.Vector3(0, 0, 0);

        // Direction relative to center (preserves any rotation the user performed during investigation)
        const dir = camera.position.clone().sub(controls.target).normalize();
        if (dir.lengthSq() < 0.001) dir.set(0, 0, 1);
        const targetPos = targetTarget.clone().add(dir.multiplyScalar(restoreDist));

        transitionRef.current = {
          active: true,
          startTime: performance.now(),
          duration: 650,
          startPos: camera.position.clone(),
          targetPos,
          startTarget: controls.target.clone(),
          targetTarget,
          startFov: camera.fov,
          targetFov: restoreFov,
        };

        // Reset saved memory for fresh baseline on next inspection
        savedObservationRef.current = null;
      }
    };

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      if (!isActive) return;   // off-screen or hidden tab: skip all work

      // Optical Instrument Focus Interpolation (Quintic Smoothstep Easing)
      if (transitionRef.current.active) {
        const now = performance.now();
        const elapsed = now - transitionRef.current.startTime;
        const rawProgress = Math.min(1, elapsed / transitionRef.current.duration);
        // Quintic smoothstep: zero 1st & 2nd derivatives at endpoints; strictly monotonic, no overshoot/bounce
        const s = rawProgress * rawProgress * rawProgress * (rawProgress * (rawProgress * 6 - 15) + 10);

        camera.position.lerpVectors(transitionRef.current.startPos, transitionRef.current.targetPos, s);
        controls.target.lerpVectors(transitionRef.current.startTarget, transitionRef.current.targetTarget, s);
        camera.fov = THREE.MathUtils.lerp(transitionRef.current.startFov, transitionRef.current.targetFov, s);
        camera.updateProjectionMatrix();

        if (rawProgress >= 1) {
          transitionRef.current.active = false;
        }
      }

      controls.update();

      // THE LAMP. In 'camera' mode it rides with the camera (lamp beside the lens), so
      // rotating the view is the same as turning the stone on a turntable under one fixed
      // lamp - which is how the reference video was shot. In 'fixed' mode it stays put.
      {
        const settings = lightingRef.current;
        const azimuth = THREE.MathUtils.degToRad(settings.azimuth);
        const elevation = THREE.MathUtils.degToRad(settings.elevation);
        const lampDir = new THREE.Vector3(
          Math.sin(azimuth) * Math.cos(elevation),
          Math.sin(elevation),
          Math.cos(azimuth) * Math.cos(elevation)
        );
        keyLight.intensity = KEY_LIGHT_INTENSITY * settings.intensity / 100;
        ambient.intensity = settings.ambient / 100;
        if (lampModeRef.current === 'camera') {
          camera.updateMatrixWorld();
          lampDir.applyQuaternion(camera.quaternion);
        }
        lampDir.normalize();
        keyLightDirUniformRef.current.value.copy(lampDir);
        keyLightStrengthUniformRef.current.value = keyLight.visible ? Math.max(0, keyLight.intensity / KEY_LIGHT_INTENSITY) : 0;
        lampWorldPosRef.current.copy(lampDir).multiplyScalar(LAMP_DISTANCE);
        keyLight.position.copy(lampWorldPosRef.current);
      }

      // Measured as if the camera were at the normal distance, so backing off to fit a narrow
      // screen does not change how the surrounding layers look.
      const camDistance = camera.position.length() / fitScaleRef.current;

      // Dynamic Spatial Layer Visibility based on Observational Proximity
      if (strataGroupRef.current) {
        // State 02: Strata emerges around 4m - 18m
        const strataOpacity = THREE.MathUtils.clamp((camDistance - 3.6) / 2.5, 0, 1) * THREE.MathUtils.clamp((28 - camDistance) / 8, 0, 1);
        strataGroupRef.current.visible = false;
        strataGroupRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Line) {
            if (child.material && 'opacity' in child.material) {
              (child.material as THREE.Material & { opacity: number }).opacity = THREE.MathUtils.clamp(strataOpacity * 0.4, 0, 0.5);
            }
          }
        });
      }

      if (territoryGroupRef.current) {
        // State 03: Territory emerges at 14m+
        const territoryOpacity = THREE.MathUtils.clamp((camDistance - 12.0) / 6.0, 0, 1);
        territoryGroupRef.current.visible = false;
      }

      // Update Investigative Cues based on Active Feature & Instrument Mode
      const activeFeat = activeFeatureIdRef.current;
      const currentMode = instrumentModeRef.current;
      const showOpticalBench = activeFeat === 'diffraction' || currentMode === 'investigate' || currentMode === 'model';

      if (inquiryGroup && modelGroupRef.current) {
        const opticalBench = inquiryGroup.getObjectByName('opticalBench') as THREE.Group;
        const matrixSurvey = inquiryGroup.getObjectByName('matrixSurvey') as THREE.Group;
        const box = inquiryGroup.getObjectByName('custodyBox') as THREE.LineSegments;

        // 1. Spatial Optical Bench
        if (opticalBench) {
          opticalBench.visible = showOpticalBench;
          if (opticalBench.visible) {
            const regionLocal = (FEATURE_POINTS['diffraction'] || new THREE.Vector3(0.35, 0.45, 0.65));
            const regionWorld = regionLocal.clone().applyMatrix4(modelGroupRef.current.matrixWorld);
            const centerWorld = modelGroupRef.current.position.clone();
            
            // Surface normal from local orientation
            const surfaceNormal = regionWorld.clone().sub(centerWorld).normalize();
            const keyLightPos = lampWorldPosRef.current.clone();
            const lightDir = keyLightPos.clone().sub(regionWorld).normalize();
            const viewDir = camera.position.clone().sub(regionWorld).normalize();
            const halfVec = lightDir.clone().add(viewDir).normalize();

            // 1a. Incident Light Ray
            const incidentLine = opticalBench.getObjectByName('incidentLine') as THREE.Line;
            const lightOrigin = regionWorld.clone().add(lightDir.clone().multiplyScalar(1.6));
            if (incidentLine) {
              const pos = incidentLine.geometry.attributes.position;
              pos.setXYZ(0, lightOrigin.x, lightOrigin.y, lightOrigin.z);
              pos.setXYZ(1, regionWorld.x, regionWorld.y, regionWorld.z);
              pos.needsUpdate = true;
              incidentLine.computeLineDistances();
            }

            // 1a-arrow. Incident Direction Cone (facing into the anchor)
            const incidentCone = opticalBench.getObjectByName('incidentCone') as THREE.Mesh;
            if (incidentCone) {
              const conePos = regionWorld.clone().add(lightDir.clone().multiplyScalar(0.45));
              incidentCone.position.copy(conePos);
              incidentCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), lightDir.clone().negate());
            }

            // 1b. Surface Normal Line
            const normalLine = opticalBench.getObjectByName('normalLine') as THREE.Line;
            const normalEnd = regionWorld.clone().add(surfaceNormal.clone().multiplyScalar(1.05));
            if (normalLine) {
              const pos = normalLine.geometry.attributes.position;
              pos.setXYZ(0, regionWorld.x, regionWorld.y, regionWorld.z);
              pos.setXYZ(1, normalEnd.x, normalEnd.y, normalEnd.z);
              pos.needsUpdate = true;
            }

            // 1b-arrow. Surface Normal Cone
            const normalCone = opticalBench.getObjectByName('normalCone') as THREE.Mesh;
            if (normalCone) {
              normalCone.position.copy(normalEnd);
              normalCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), surfaceNormal);
            }

            // 1b-bracket. Orthogonal Corner Bracket
            const bracketLine = opticalBench.getObjectByName('bracketLine') as THREE.Line;
            if (bracketLine) {
              const bSize = 0.08;
              const tangent = new THREE.Vector3(0, 1, 0).cross(surfaceNormal).normalize();
              const p1 = regionWorld.clone().add(surfaceNormal.clone().multiplyScalar(bSize));
              const p2 = p1.clone().add(tangent.clone().multiplyScalar(bSize));
              const p3 = regionWorld.clone().add(tangent.clone().multiplyScalar(bSize));
              bracketLine.geometry.setFromPoints([p1, p2, p3]);
            }

            // 1c. Observer Line
            const observerLine = opticalBench.getObjectByName('observerLine') as THREE.Line;
            const observerEnd = regionWorld.clone().add(viewDir.clone().multiplyScalar(1.5));
            if (observerLine) {
              const pos = observerLine.geometry.attributes.position;
              pos.setXYZ(0, regionWorld.x, regionWorld.y, regionWorld.z);
              pos.setXYZ(1, observerEnd.x, observerEnd.y, observerEnd.z);
              pos.needsUpdate = true;
              observerLine.computeLineDistances();
            }

            // 1c-arrow. Observer Cone
            const observerCone = opticalBench.getObjectByName('observerCone') as THREE.Mesh;
            if (observerCone) {
              observerCone.position.copy(observerEnd);
              observerCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), viewDir);
            }

            // 1d. Half-Vector (Bisector) Line
            const halfVecLine = opticalBench.getObjectByName('halfVecLine') as THREE.Line;
            if (halfVecLine) {
              const halfEnd = regionWorld.clone().add(halfVec.clone().multiplyScalar(0.75));
              const pos = halfVecLine.geometry.attributes.position;
              pos.setXYZ(0, regionWorld.x, regionWorld.y, regionWorld.z);
              pos.setXYZ(1, halfEnd.x, halfEnd.y, halfEnd.z);
              pos.needsUpdate = true;
              halfVecLine.computeLineDistances();
            }

            // 1e. Surface Reticle & Crosshair
            const surfaceReticle = opticalBench.getObjectByName('surfaceReticle') as THREE.Mesh;
            if (surfaceReticle) {
              surfaceReticle.position.copy(regionWorld).add(surfaceNormal.clone().multiplyScalar(0.008));
              surfaceReticle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), surfaceNormal);
            }
            const crosshairLine = opticalBench.getObjectByName('crosshairLine') as THREE.LineSegments;
            if (crosshairLine) {
              crosshairLine.position.copy(regionWorld).add(surfaceNormal.clone().multiplyScalar(0.009));
              crosshairLine.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), surfaceNormal);
            }

            // 1f. Coordinate Arc
            const angularArc = opticalBench.getObjectByName('angularArc') as THREE.Line;
            let arcMidWorld = regionWorld.clone();
            if (angularArc) {
              const arcPos = angularArc.geometry.attributes.position as THREE.BufferAttribute;
              const count = arcPos.count;
              const arcRadius = 0.58;
              for (let i = 0; i < count; i++) {
                const t = i / (count - 1);
                const dir = new THREE.Vector3().copy(lightDir).lerp(surfaceNormal, t).normalize();
                const p = regionWorld.clone().add(dir.multiplyScalar(arcRadius));
                arcPos.setXYZ(i, p.x, p.y, p.z);
                if (i === Math.floor(count / 2)) {
                  arcMidWorld = p.clone();
                }
              }
              arcPos.needsUpdate = true;
            }

            // 1g. Microstructure Lattice Planes (Active in MODEL state)
            const latticeGroup = opticalBench.getObjectByName('latticePlanes') as THREE.Group;
            if (latticeGroup) {
              latticeGroup.visible = currentMode === 'model';
              if (latticeGroup.visible) {
                latticeGroup.position.copy(regionWorld);
                latticeGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), surfaceNormal);
              }
            }

            // 1h. Project 3D Optical Bench Coordinates to 2D
            if (onOpticalBenchProjectedRef.current) {
              const rect = renderer.domElement.getBoundingClientRect();
              const projectPoint = (vec: THREE.Vector3) => {
                const p = vec.clone().project(camera);
                const isBehind = p.z > 1;
                return {
                  x: (p.x * 0.5 + 0.5) * rect.width,
                  y: (p.y * -0.5 + 0.5) * rect.height,
                  visible: !isBehind,
                };
              };

              onOpticalBenchProjectedRef.current({
                anchor: projectPoint(regionWorld),
                lightSource: projectPoint(lightOrigin),
                normalTip: projectPoint(normalEnd),
                observerTip: projectPoint(observerEnd),
                arcMid: projectPoint(arcMidWorld),
              });
            }
          }
        }

        // 2. Matrix Survey Geological Apparatus
        if (matrixSurvey) {
          matrixSurvey.visible = activeFeat === 'material';
          if (matrixSurvey.visible) {
            const regionLocal = (FEATURE_POINTS['material'] || new THREE.Vector3(-0.65, -0.2, 0.45));
            const regionWorld = regionLocal.clone().applyMatrix4(modelGroupRef.current.matrixWorld);
            const centerWorld = modelGroupRef.current.position.clone();
            const surfaceNormal = regionWorld.clone().sub(centerWorld).normalize();

            // 2a. Geological Reference Plane
            const gridPlane = matrixSurvey.getObjectByName('geologicalRefPlane') as THREE.LineSegments;
            if (gridPlane) {
              gridPlane.position.copy(regionWorld);
              gridPlane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), surfaceNormal);
            }

            // 2b. Stratigraphic Axis Line & Cone
            const axisLine = matrixSurvey.getObjectByName('stratigraphicAxis') as THREE.Line;
            const axisTipWorld = regionWorld.clone().add(surfaceNormal.clone().multiplyScalar(1.25));
            if (axisLine) {
              const pos = axisLine.geometry.attributes.position;
              pos.setXYZ(0, regionWorld.x, regionWorld.y, regionWorld.z);
              pos.setXYZ(1, axisTipWorld.x, axisTipWorld.y, axisTipWorld.z);
              pos.needsUpdate = true;
              axisLine.computeLineDistances();
            }
            const axisCone = matrixSurvey.getObjectByName('stratigraphicCone') as THREE.Mesh;
            if (axisCone) {
              axisCone.position.copy(axisTipWorld);
              axisCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), surfaceNormal);
            }

            // 2c. Interface Reticle & Crosshair
            const ifaceReticle = matrixSurvey.getObjectByName('ifaceReticle') as THREE.Mesh;
            if (ifaceReticle) {
              ifaceReticle.position.copy(regionWorld).add(surfaceNormal.clone().multiplyScalar(0.008));
              ifaceReticle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), surfaceNormal);
            }
            const ifaceCross = matrixSurvey.getObjectByName('ifaceCross') as THREE.LineSegments;
            if (ifaceCross) {
              ifaceCross.position.copy(regionWorld).add(surfaceNormal.clone().multiplyScalar(0.009));
              ifaceCross.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), surfaceNormal);
            }

            // 2d. Sectioning Clipping Plane Calculation
            const sectionFrame = matrixSurvey.getObjectByName('sectionFrame') as THREE.LineSegments;
            const isSectioning = sectionEnabledRef.current;
            const offsetVal = sectionOffsetRef.current ?? 0;
            const slicePoint = regionWorld.clone().add(surfaceNormal.clone().multiplyScalar(offsetVal * 0.5));

            if (isSectioning) {
              if (sectionFrame) {
                sectionFrame.visible = true;
                sectionFrame.position.copy(slicePoint);
                sectionFrame.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), surfaceNormal);
              }
              localClippingPlane.setFromNormalAndCoplanarPoint(surfaceNormal, slicePoint);
              modelMaterialsRef.current.forEach(mat => {
                mat.clippingPlanes = [localClippingPlane];
              });
            } else {
              if (sectionFrame) sectionFrame.visible = false;
              modelMaterialsRef.current.forEach(mat => {
                mat.clippingPlanes = [];
              });
            }

            // 2e. Project 3D Matrix Coordinates to 2D
            if (onMatrixBenchProjectedRef.current) {
              const rect = renderer.domElement.getBoundingClientRect();
              const projectPoint = (vec: THREE.Vector3) => {
                const p = vec.clone().project(camera);
                const isBehind = p.z > 1;
                return {
                  x: (p.x * 0.5 + 0.5) * rect.width,
                  y: (p.y * -0.5 + 0.5) * rect.height,
                  visible: !isBehind,
                };
              };

              const tangent = new THREE.Vector3(0, 1, 0).cross(surfaceNormal).normalize();
              const planeExtWorld = regionWorld.clone().add(tangent.multiplyScalar(0.8));

              onMatrixBenchProjectedRef.current({
                anchor: projectPoint(regionWorld),
                axisTip: projectPoint(axisTipWorld),
                planeOrigin: projectPoint(planeExtWorld),
                sectionMarker: projectPoint(slicePoint),
              });
            }
          } else if (!sectionEnabledRef.current) {
            modelMaterialsRef.current.forEach(mat => {
              mat.clippingPlanes = [];
            });
          }
        }

        // 3. Custody Frame
        if (box) {
          box.visible = activeFeat === 'custody' || currentMode === 'verify';
          if (box.visible) {
            box.position.copy(modelGroupRef.current.position);
            box.rotation.copy(modelGroupRef.current.rotation);
          }
        }
      }

      // Compute Honest Observational View Geometry
      if (modelGroupRef.current && onOpticalMetricsChangeRef.current) {
        const regionLocal = FEATURE_POINTS['diffraction'] || new THREE.Vector3(0.35, 0.45, 0.65);
        const regionWorld = regionLocal.clone().applyMatrix4(modelGroupRef.current.matrixWorld);
        const centerWorld = modelGroupRef.current.position.clone();
        const surfaceNormal = regionWorld.clone().sub(centerWorld).normalize();

        const keyLightPos = lampWorldPosRef.current.clone();
        const lightDir = keyLightPos.clone().sub(regionWorld).normalize();
        const viewDir = camera.position.clone().sub(regionWorld).normalize();
        const halfVec = lightDir.clone().add(viewDir).normalize();

        const dotLightNormal = Math.max(0, Math.min(1, surfaceNormal.dot(lightDir)));
        const dotViewNormal = Math.max(0, Math.min(1, surfaceNormal.dot(viewDir)));
        const specularAlignment = Math.max(0, Math.min(1, surfaceNormal.dot(halfVec)));

        const angleOfIncidence = Math.round(Math.acos(dotLightNormal) * (180 / Math.PI));
        const viewAngle = Math.round(Math.acos(dotViewNormal) * (180 / Math.PI));
        const lightAzimuthDeg = Math.round((Math.atan2(lightDir.x, lightDir.z) * (180 / Math.PI) + 360) % 360);

        let relativeIllumination = 'DIRECT KEY ILLUMINATION';
        if (specularAlignment > 0.85 && dotLightNormal > 0.1) {
          relativeIllumination = 'SPECULAR HIGHLIGHT REGIME (PEAK)';
        } else if (specularAlignment > 0.65 && dotLightNormal > 0.1) {
          relativeIllumination = 'OBLIQUE SPECULAR REGIME';
        } else if (dotLightNormal > 0.45) {
          relativeIllumination = 'DIRECT KEY ILLUMINATION';
        } else if (dotLightNormal > 0.08) {
          relativeIllumination = 'GRAZING / OBLIQUE REGIME';
        } else {
          relativeIllumination = 'SHADOW / BACKLIT REGIME';
        }

        onOpticalMetricsChangeRef.current({
          angleOfIncidence,
          viewAngle,
          lightAzimuthDeg,
          relativeIllumination,
          specularAlignment: Number(specularAlignment.toFixed(3)),
        });
      }

      if (modelGroupRef.current && autoRotateRef.current) {
        modelGroupRef.current.rotation.y += delta * 0.05;
      }

      // Feature Point Projection onto 2D Viewport
      if (onFeaturesProjectedRef.current && modelGroupRef.current) {
        const projectedFeatures: ProjectedFeature[] = [];
        const rect = renderer.domElement.getBoundingClientRect();
        
        let bestFeatureId: string | null = null;
        let bestScore = -Infinity;

        const activeFeaturesToProject = featuresRef.current.length > 0 
          ? featuresRef.current 
          : Object.keys(FEATURE_POINTS);

        activeFeaturesToProject.forEach(id => {
          const localPos = FEATURE_POINTS[id];
          if (localPos) {
            const worldPos = localPos.clone().applyMatrix4(modelGroupRef.current!.matrixWorld);
            const cameraToPoint = worldPos.clone().sub(camera.position).normalize();
            const centerToPoint = worldPos.clone().sub(modelGroupRef.current!.position).normalize();
            const dot = cameraToPoint.dot(centerToPoint);
            
            // dot close to -1 means it faces towards the camera
            const facingScore = -dot;
            const isFacingCamera = facingScore > -0.35;

            const projected = worldPos.clone().project(camera);
            
            if (projected.z <= 1) {
              const x = (projected.x * 0.5 + 0.5) * rect.width;
              const y = (projected.y * -0.5 + 0.5) * rect.height;
              projectedFeatures.push({ 
                id, 
                x, 
                y, 
                visible: isFacingCamera,
                worldX: worldPos.x,
                worldY: worldPos.y,
                worldZ: worldPos.z,
              });

              if (isFacingCamera) {
                const distFromCenter = Math.sqrt(projected.x * projected.x + projected.y * projected.y);
                const score = facingScore * 2 - distFromCenter;
                if (score > bestScore) {
                  bestScore = score;
                  bestFeatureId = id;
                }
              }
            }
          }
        });
        
        if (bestFeatureId && onActiveFeatureChangeRef.current) {
          onActiveFeatureChangeRef.current(bestFeatureId);
        }

        onFeaturesProjectedRef.current(projectedFeatures);
      }

      if (onCameraChangeRef.current) {
        onCameraChangeRef.current(camDistance);
      }

      if (onOrientationChangeRef.current) {
        const spherical = new THREE.Spherical().setFromVector3(camera.position);
        const azimuthDeg = Math.round(THREE.MathUtils.radToDeg(spherical.theta));
        const inclinationDeg = Math.round(THREE.MathUtils.radToDeg(spherical.phi - Math.PI / 2));
        onOrientationChangeRef.current(azimuthDeg, inclinationDeg);
      }

      // DIRECTIVE 17: Telemetry calculation for Developer Calibration Rig
      // (only needed while the developer panels are on screen)
      if (showInstrumentsRef.current && modelGroupRef.current) {
        const rotEuler = modelGroupRef.current.rotation;
        const pitchDeg = Math.round(THREE.MathUtils.radToDeg(rotEuler.x));
        const yawDeg = Math.round(THREE.MathUtils.radToDeg(rotEuler.y));
        const rollDeg = Math.round(THREE.MathUtils.radToDeg(rotEuler.z));

        const spherical = new THREE.Spherical().setFromVector3(camera.position);
        const camAzimuth = Math.round(THREE.MathUtils.radToDeg(spherical.theta));
        const camElevation = Math.round(THREE.MathUtils.radToDeg(Math.PI / 2 - spherical.phi));

        // Representative orientation of the two main domains, in the stone's local space:
        //  green = the big green mosaic on the flat face (flashing at 0:00 in the video)
        //  blue  = the blue patch low on the stone (flashing at 0:14 in the video)
        // These are the same directions the baked orientation image holds for those patches.
        const greenLocalNorm = new THREE.Vector3(0.008, 0.268, 0.963).normalize();
        const blueLocalNorm = new THREE.Vector3(-0.524, 0.764, 0.377).normalize();

        const greenWorldNorm = greenLocalNorm.clone().applyEuler(rotEuler).normalize();
        const blueWorldNorm = blueLocalNorm.clone().applyEuler(rotEuler).normalize();

        const keyLightPosVec = lampWorldPosRef.current.clone();
        const keyLightDir = keyLightPosVec.clone().normalize();
        const viewDir = camera.position.clone().normalize();
        const halfVec = keyLightDir.clone().add(viewDir).normalize();
        const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();

        // Same flash profile and Bragg relation as the shader.
        const lobeFn = (c: number) => 0.15 * Math.pow(c, 10.0) + 0.30 * Math.pow(c, 30.0) + 0.55 * Math.pow(c, 80.0);

        const cosHalfGreen = Math.max(0, greenWorldNorm.dot(halfVec));
        const cosLightGreen = Math.max(0, greenWorldNorm.dot(keyLightDir));
        const cosThetaVGreen = Math.max(0, greenWorldNorm.dot(viewDir));
        const nSilica = OPAL_N_SILICA;
        const dGreen = OPAL_D_GREEN_NM;
        const shiftFactorGreen = Math.sqrt(Math.max(0, nSilica * nSilica - 1.0 + cosLightGreen * cosLightGreen));
        const lambdaGreen = 2.0 * dGreen * shiftFactorGreen;
        const flashGreen = lobeFn(cosHalfGreen) * cosLightGreen * OPAL_FLASH_GAIN;
        const greenResp = Number(Math.min(1.0, flashGreen / OPAL_FLASH_GAIN).toFixed(3));

        const cosHalfBlue = Math.max(0, blueWorldNorm.dot(halfVec));
        const cosLightBlue = Math.max(0, blueWorldNorm.dot(keyLightDir));
        const dBlue = OPAL_D_BLUE_NM;
        const shiftFactorBlue = Math.sqrt(Math.max(0, nSilica * nSilica - 1.0 + cosLightBlue * cosLightBlue));
        const lambdaBlue = 2.0 * dBlue * shiftFactorBlue;
        const flashBlue = lobeFn(cosHalfBlue) * cosLightBlue * OPAL_FLASH_GAIN;
        const blueResp = Number(Math.min(1.0, flashBlue / OPAL_FLASH_GAIN).toFixed(3));

        const totalResp = Number(Math.max(greenResp, blueResp).toFixed(3));
        const flashFactorNum = Number(Math.max(flashGreen, flashBlue).toFixed(3));

        const cosThetaI = Number(cosLightGreen.toFixed(3));
        const cosThetaV = Number(cosThetaVGreen.toFixed(3));
        const cosHalfNum = Number(cosHalfGreen.toFixed(3));
        const lambdaGreenNum = Number(lambdaGreen.toFixed(1));
        const lambdaBlueNum = Number(lambdaBlue.toFixed(1));

        setCalibrationTelemetry(prev => {
          if (
            prev.pitchDeg === pitchDeg &&
            prev.yawDeg === yawDeg &&
            prev.rollDeg === rollDeg &&
            prev.camAzimuth === camAzimuth &&
            prev.camElevation === camElevation &&
            Math.abs(prev.greenResponse - greenResp) < 0.01 &&
            Math.abs(prev.blueResponse - blueResp) < 0.01
          ) {
            return prev;
          }
          return {
            ...prev,
            pitchDeg,
            yawDeg,
            rollDeg,
            camAzimuth,
            camElevation,
            camDistance: Number(camDistance.toFixed(2)),
            camPos: [Number(camera.position.x.toFixed(2)), Number(camera.position.y.toFixed(2)), Number(camera.position.z.toFixed(2))],
            camDir: [Number(camDir.x.toFixed(2)), Number(camDir.y.toFixed(2)), Number(camDir.z.toFixed(2))],
            keyLightPos: [Number(lampWorldPosRef.current.x.toFixed(2)), Number(lampWorldPosRef.current.y.toFixed(2)), Number(lampWorldPosRef.current.z.toFixed(2))],
            L: [Number(keyLightDir.x.toFixed(3)), Number(keyLightDir.y.toFixed(3)), Number(keyLightDir.z.toFixed(3))],
            V: [Number(viewDir.x.toFixed(3)), Number(viewDir.y.toFixed(3)), Number(viewDir.z.toFixed(3))],
            H: [Number(halfVec.x.toFixed(3)), Number(halfVec.y.toFixed(3)), Number(halfVec.z.toFixed(3))],
            flashFactor: flashFactorNum,
            greenResponse: greenResp,
            blueResponse: blueResp,
            totalResponse: totalResp,
          };
        });
      }

      renderer.render(scene, camera);
    };

    animate();

    // Direct Raycasting Click Selection on 3D Specimen & User Interruption Yield
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const interruptAndTakeControl = () => {
      if (transitionRef.current.active) {
        transitionRef.current.active = false;
      }
      if (autoRotateRef.current) {
        autoRotateRef.current = false;
        onInteractionStartRef.current?.();
      }
    };

    controls.addEventListener('start', interruptAndTakeControl);

    capturePhysicalFrontRef.current = () => {
      if (!cameraRef.current || !modelGroupRef.current) return;

      // The camera looks at the origin, so origin -> camera is the direction of the face
      // the viewer is looking straight at.
      const worldFront = cameraRef.current.position.clone().normalize();

      // Transform that world direction into the stone's local space.
      modelGroupRef.current.updateMatrixWorld(true);
      const inverseRotation = new THREE.Matrix4().extractRotation(modelGroupRef.current.matrixWorld).invert();
      const localFront = worldFront.clone().applyMatrix4(inverseRotation).normalize();

      setCapturedFrontWorld(worldFront.clone());
      setCapturedFrontLocal(localFront.clone());

      // Write straight into the shared uniform that every material's shader reads.
      // (The previous version looked for material.userData.shader, which was never set,
      // so this button silently changed nothing.)
      specimenFrontUniformRef.current.value.copy(localFront);
      // NOTE: the light is deliberately NOT moved. One fixed lamp, as in the reference video.
    };

    resetPhysicalFrontRef.current = () => {
      specimenFrontUniformRef.current.value.copy(MEASURED_FRONT_LOCAL);
      setCapturedFrontWorld(null);
      setCapturedFrontLocal(null);
    };

  const handlePointerDown = (e: MouseEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
      interruptAndTakeControl();
    };

    const handlePointerUp = (e: MouseEvent) => {
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 6) return; // Dragged for orbit, do not trigger click

      if (!canvasRef.current || !modelGroupRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(modelGroupRef.current.children, true);

      if (intersects.length > 0) {
        const hitPoint = intersects[0].point;
        // Check distance to feature points
        let closestFeat: string = 'diffraction';
        let minD = Infinity;
        Object.entries(FEATURE_POINTS).forEach(([id, localVec]) => {
          const worldVec = localVec.clone().applyMatrix4(modelGroupRef.current!.matrixWorld);
          const d = worldVec.distanceTo(hitPoint);
          if (d < minD) {
            minD = d;
            closestFeat = id;
          }
        });
        onFeatureSelectRef.current?.(closestFeat);
      } else {
        // Clicked background
        onFeatureSelectRef.current?.(null);
      }
    };

    const handleWheel = () => {
      interruptAndTakeControl();
    };

    const handleTouchStart = () => {
      interruptAndTakeControl();
    };

    const canvasEl = canvasRef.current;
    if (canvasEl) {
      canvasEl.addEventListener('pointerdown', handlePointerDown);
      canvasEl.addEventListener('pointerup', handlePointerUp);
      canvasEl.addEventListener('wheel', handleWheel, { passive: true });
      canvasEl.addEventListener('touchstart', handleTouchStart, { passive: true });
    }

    let resizeAnimId: number | null = null;
    const handleResize = () => {
      if (resizeAnimId) cancelAnimationFrame(resizeAnimId);
      resizeAnimId = requestAnimationFrame(() => {
        if (!container || isDisposed) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w === 0 || h === 0) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
        // Phone turned, window resized: back the camera off (or bring it in) to match the new
        // shape, keeping whatever zoom the visitor had chosen.
        const nextFit = fitWidthRef.current ? fitScaleForAspect(w / h) : 1;
        if (nextFit !== fitScaleRef.current) {
          camera.position.multiplyScalar(nextFit / fitScaleRef.current);
          fitScaleRef.current = nextFit;
          controls.update();
        }
      });
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // Pause drawing while the viewer is off-screen or the tab is in the background.
    let inView = true;
    let tabVisible = document.visibilityState !== 'hidden';
    const updateActive = () => { isActive = inView && tabVisible; };
    const intersectionObserver = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          inView = entries[entries.length - 1].isIntersecting;
          updateActive();
        }, { threshold: 0 })
      : null;
    intersectionObserver?.observe(container);
    const handleVisibility = () => {
      tabVisible = document.visibilityState !== 'hidden';
      updateActive();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // If the browser takes the graphics context away (common on phones under memory
    // pressure), tell the page so it can fall back to the photo rather than show a dead canvas.
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      console.warn('[opal] WebGL context lost');
      onLoadErrorRef.current?.();
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);

    return () => {
      isDisposed = true;
      loadedOpticalTextures.forEach(tex => tex.dispose());
      intersectionObserver?.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      if (resizeAnimId) cancelAnimationFrame(resizeAnimId);
      controls.removeEventListener('start', interruptAndTakeControl);
      if (canvasEl) {
        canvasEl.removeEventListener('pointerdown', handlePointerDown);
        canvasEl.removeEventListener('pointerup', handlePointerUp);
        canvasEl.removeEventListener('wheel', handleWheel);
        canvasEl.removeEventListener('touchstart', handleTouchStart);
      }
      resizeObserver.disconnect();
      cancelAnimationFrame(animationFrameId);
      controls.dispose();
      renderer.dispose();
      scene.clear();
    };
  }, [createProceduralSpecimen, modelUrl, opticalMaps?.flash, opticalMaps?.domain]);

  return <div ref={containerRef} className={`opal-viewer ${className}`}>
    <canvas ref={canvasRef} tabIndex={0} aria-label="Interactive scanned opal. Drag to rotate; pinch or scroll to zoom." />
  </div>;
});
