import { useState, useMemo, useRef, useEffect, Suspense } from 'react';
import { Canvas, useFrame, extend } from '@react-three/fiber';
import {
  OrbitControls,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  Stars,
  Sparkles
} from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { MathUtils } from 'three';
import * as random from 'maath/random';
import { GestureRecognizer, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

// --- 视觉配置 ---
const CONFIG = {
  colors: {
    heart: '#FF1744', // 红色 hati
    pink: '#FF69B4', // Pink
    gold: '#FFD700',
    silver: '#ECEFF1',
    red: '#FF1744',
    rose: '#FF1493',
    white: '#FFFFFF',   // 纯白色
    warmLight: '#FFB6C1', // Pink light
    lights: ['#FF1744', '#FF69B4', '#FF1493', '#FFB6C1'], // Love lights
    // Love elements colors
    giftColors: ['#FF1744', '#FF69B4', '#FF1493', '#FFB6C1'],
    candyColors: ['#FF1744', '#FFFFFF'],
    textParticles: ['#FFD700', '#FF69B4', '#FF1744', '#FF1493', '#FFB6C1'] // Colors for text particles
  },
  counts: {
    textParticlesTop: 4000, // Partikel untuk teks "Happy Birthday ❤️"
    textParticlesBottom: 3000, // Partikel untuk nama
  },
  text: {
    fontSize: 3.5,
    letterSpacing: 0.3,
    depth: 0.5,
    lineSpacing: 8 // Jarak antara baris atas dan bawah
  }
};

// --- Shader Material (Heart) ---
const FoliageMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color(CONFIG.colors.heart), uProgress: 0, uPulse: 1.0 },
  `uniform float uTime; uniform float uProgress; uniform float uPulse; attribute vec3 aTargetPos; attribute float aRandom;
  varying vec2 vUv; varying float vMix;
  float cubicInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0; }
  void main() {
    vUv = uv;
    vec3 noise = vec3(sin(uTime * 1.5 + position.x), cos(uTime + position.y), sin(uTime * 1.5 + position.z)) * 0.15;
    float t = cubicInOut(uProgress);
    vec3 finalPos = mix(position, aTargetPos * uPulse + noise, t);
    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
    gl_PointSize = (60.0 * (1.0 + aRandom)) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    vMix = t;
  }`,
  `uniform vec3 uColor; varying float vMix;
  void main() {
    float r = distance(gl_PointCoord, vec2(0.5)); if (r > 0.5) discard;
    vec3 finalColor = mix(uColor * 0.3, uColor * 1.2, vMix);
    gl_FragColor = vec4(finalColor, 1.0);
  }`
);
extend({ FoliageMaterial });

// --- Shader Material (Text Particles with Vertex Colors) ---
const TextParticleMaterial = shaderMaterial(
  { uTime: 0, uProgress: 0 },
  `uniform float uTime; uniform float uProgress; attribute vec3 aTargetPos; attribute float aRandom;
  varying vec3 vColor; varying float vMix;
  float cubicInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0; }
  void main() {
    vColor = color;
    vec3 noise = vec3(sin(uTime * 2.0 + position.x), cos(uTime * 1.5 + position.y), sin(uTime * 2.0 + position.z)) * 0.1;
    float t = cubicInOut(uProgress);
    vec3 finalPos = mix(position, aTargetPos + noise, t);
    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
    gl_PointSize = (80.0 * (1.0 + aRandom * 0.5)) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    vMix = t;
  }`,
  `varying vec3 vColor; varying float vMix;
  void main() {
    float r = distance(gl_PointCoord, vec2(0.5)); if (r > 0.5) discard;
    vec3 finalColor = mix(vColor * 0.5, vColor * 2.0, vMix);
    float alpha = (1.0 - r * 2.0) * (0.7 + vMix * 0.3);
    gl_FragColor = vec4(finalColor, alpha);
  }`
);
extend({ TextParticleMaterial });



// --- Helper: Generate text positions using Canvas 2D for accurate text shape ---
const getTextPositions = (text: string, fontSize: number, depth: number, targetCount?: number): THREE.Vector3[] => {
  const positions: THREE.Vector3[] = [];
  
  // Create a canvas to render text and sample pixels
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return positions;
  
  // Set canvas size (higher resolution for better quality)
  const scale = 4; // Higher scale = more particles per pixel
  const baseWidth = 800;
  const baseHeight = 200;
  canvas.width = baseWidth * scale;
  canvas.height = baseHeight * scale;
  
  // Clear canvas
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Draw text
  ctx.fillStyle = 'white';
  ctx.font = `bold ${fontSize * scale * 10}px Arial`; // Scale font size
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  
  // Sample pixels to get positions
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  // Sample every Nth pixel to get particle positions
  const sampleStep = 2; // Sample every 2 pixels for performance
  const pixelToWorldScale = fontSize / (fontSize * scale * 10); // Convert pixel to world units
  
  for (let y = 0; y < canvas.height; y += sampleStep) {
    for (let x = 0; x < canvas.width; x += sampleStep) {
      const index = (y * canvas.width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const alpha = data[index + 3];
      
      // If pixel is white (text), add particle position
      if (alpha > 128 && (r > 200 || g > 200 || b > 200)) {
        // Convert canvas coordinates to world coordinates
        const worldX = (x - canvas.width / 2) * pixelToWorldScale;
        const worldY = (canvas.height / 2 - y) * pixelToWorldScale; // Flip Y axis
        
        // Add depth variation (multiple layers)
        for (let layer = 0; layer < 2; layer++) {
          const z = (layer - 0.5) * depth * 0.4;
          positions.push(new THREE.Vector3(worldX, worldY, z));
        }
      }
    }
  }
  
  // Target particle count
  const count = targetCount || Math.max(CONFIG.counts.textParticlesTop, CONFIG.counts.textParticlesBottom);
  
  // If we have too many positions, randomly sample them
  if (positions.length > count) {
    const sampled: THREE.Vector3[] = [];
    const step = positions.length / count;
    for (let i = 0; i < count; i++) {
      const index = Math.floor(i * step);
      sampled.push(positions[index]);
    }
    return sampled;
  }
  
  // If we don't have enough positions, add some random ones near text area
  if (positions.length < count) {
    const needed = count - positions.length;
    
    // Get bounding box from existing positions
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    positions.forEach(pos => {
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
    });
    
    for (let i = 0; i < needed; i++) {
      const x = minX + (maxX - minX) * Math.random();
      const y = minY + (maxY - minY) * Math.random();
      const z = (Math.random() - 0.5) * depth;
      positions.push(new THREE.Vector3(x, y, z));
    }
  }
  
  return positions;
};

// --- Component: Text Particles (Reusable) ---
const TextParticles = ({ 
  text, 
  state, 
  count, 
  yOffset 
}: { 
  text: string; 
  state: 'CHAOS' | 'FORMED'; 
  count: number;
  yOffset: number;
}) => {
  const materialRef = useRef<any>(null);
  const groupRef = useRef<THREE.Points>(null);
  
  const { initialPositions, targetPositions, randoms, colors } = useMemo(() => {
    // Generate target positions from text shape
    const textPositions = getTextPositions(
      text,
      CONFIG.text.fontSize,
      CONFIG.text.depth,
      count
    );
    
    // Pad or trim to match count
    while (textPositions.length < count) {
      const randomPos = textPositions[Math.floor(Math.random() * textPositions.length)];
      textPositions.push(randomPos.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5
      )));
    }
    
    const initialPositions = new Float32Array(count * 3);
    const targetPositions = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    
    // Start from random chaos positions
    const spherePoints = random.inSphere(new Float32Array(count * 3), { radius: 30 }) as Float32Array;
    
    for (let i = 0; i < count; i++) {
      // Initial chaos position
      initialPositions[i*3] = spherePoints[i*3];
      initialPositions[i*3+1] = spherePoints[i*3+1];
      initialPositions[i*3+2] = spherePoints[i*3+2];
      
      // Target position from text
      const targetPos = textPositions[i % textPositions.length];
      targetPositions[i*3] = targetPos.x;
      targetPositions[i*3+1] = targetPos.y + yOffset;
      targetPositions[i*3+2] = targetPos.z;
      
      randoms[i] = Math.random();
      
      // Random color from text particle colors
      const color = new THREE.Color(
        CONFIG.colors.textParticles[Math.floor(Math.random() * CONFIG.colors.textParticles.length)]
      );
      colors[i*3] = color.r;
      colors[i*3+1] = color.g;
      colors[i*3+2] = color.b;
    }
    
    return { initialPositions, targetPositions, randoms, colors };
  }, [text, count, yOffset]);

  useFrame((rootState, delta) => {
    if (materialRef.current && groupRef.current) {
      materialRef.current.uTime = rootState.clock.elapsedTime;
      const targetProgress = state === 'FORMED' ? 1 : 0;
      materialRef.current.uProgress = MathUtils.damp(
        materialRef.current.uProgress || 0,
        targetProgress,
        2.0,
        delta
      );
    }
  });

  return (
    <points ref={groupRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[initialPositions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        <bufferAttribute attach="attributes-aTargetPos" args={[targetPositions, 3]} />
        <bufferAttribute attach="attributes-aRandom" args={[randoms, 1]} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <textParticleMaterial ref={materialRef} transparent depthWrite={false} blending={THREE.AdditiveBlending} vertexColors />
    </points>
  );
};


// --- Main Scene Experience ---
const Experience = ({ sceneState, rotationSpeed }: { sceneState: 'CHAOS' | 'FORMED', rotationSpeed: number, customName: string }) => {
  const controlsRef = useRef<any>(null);
  useFrame(() => {
    if (controlsRef.current) {
      controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + rotationSpeed);
      controlsRef.current.update();
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 8, 60]} fov={45} />
      <OrbitControls ref={controlsRef} enablePan={false} enableZoom={true} minDistance={30} maxDistance={120} autoRotate={rotationSpeed === 0 && sceneState === 'FORMED'} autoRotateSpeed={0.3} maxPolarAngle={Math.PI / 1.7} />

      <color attach="background" args={['#1a0005']} />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <Environment preset="night" background={false} />

      <ambientLight intensity={0.4} color="#330011" />
      <pointLight position={[30, 30, 30]} intensity={100} color={CONFIG.colors.warmLight} />
      <pointLight position={[-30, 10, -30]} intensity={50} color={CONFIG.colors.pink} />
      <pointLight position={[0, -20, 10]} intensity={30} color="#FFB6C1" />

      <group position={[0, 0, 0]}>
        <Suspense fallback={null}>
          <TextParticles 
            text="Happy Birthday 🎉🎂🥳" 
            state={sceneState} 
            count={CONFIG.counts.textParticlesTop}
            yOffset={CONFIG.text.lineSpacing / 2}
          />
          <TextParticles 
            text="Rea 💗" 
            state={sceneState} 
            count={CONFIG.counts.textParticlesBottom}
            yOffset={-CONFIG.text.lineSpacing / 2}
          />
        </Suspense>
        <Sparkles count={600} scale={50} size={8} speed={0.4} opacity={0.4} color={CONFIG.colors.silver} />
      </group>

      <EffectComposer>
        <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.1} intensity={1.5} radius={0.5} mipmapBlur />
        <Vignette eskil={false} offset={0.1} darkness={1.2} />
      </EffectComposer>
    </>
  );
};

// --- Gesture Controller ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GestureController = ({ onGesture, onMove, onStatus, debugMode }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let gestureRecognizer: GestureRecognizer;
    let requestRef: number;

    const setup = async () => {
      onStatus("DOWNLOADING AI...");
      try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });
        onStatus("REQUESTING CAMERA...");
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
            onStatus("AI READY: SHOW HAND");
            predictWebcam();
          }
        } else {
            onStatus("ERROR: CAMERA PERMISSION DENIED");
        }
      } catch (err: any) {
        onStatus(`ERROR: ${err.message || 'MODEL FAILED'}`);
      }
    };

    const predictWebcam = () => {
      if (gestureRecognizer && videoRef.current && canvasRef.current) {
        if (videoRef.current.videoWidth > 0) {
            const results = gestureRecognizer.recognizeForVideo(videoRef.current, Date.now());
            const ctx = canvasRef.current.getContext("2d");
            if (ctx && debugMode) {
                ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                canvasRef.current.width = videoRef.current.videoWidth; canvasRef.current.height = videoRef.current.videoHeight;
                if (results.landmarks) for (const landmarks of results.landmarks) {
                        const drawingUtils = new DrawingUtils(ctx);
                        drawingUtils.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: "#FFD700", lineWidth: 2 });
                        drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 1 });
                }
            } else if (ctx && !debugMode) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

            if (results.gestures.length > 0) {
              const name = results.gestures[0][0].categoryName; const score = results.gestures[0][0].score;
              if (score > 0.4) {
                 if (name === "Open_Palm") onGesture("CHAOS"); if (name === "Closed_Fist") onGesture("FORMED");
                 if (debugMode) onStatus(`DETECTED: ${name}`);
              }
              if (results.landmarks.length > 0) {
                const speed = (0.5 - results.landmarks[0][0].x) * 0.15;
                onMove(Math.abs(speed) > 0.01 ? speed : 0);
              }
            } else { onMove(0); if (debugMode) onStatus("AI READY: NO HAND"); }
        }
        requestRef = requestAnimationFrame(predictWebcam);
      }
    };
    setup();
    return () => cancelAnimationFrame(requestRef);
  }, [onGesture, onMove, onStatus, debugMode]);

  return (
    <>
      <video ref={videoRef} style={{ opacity: debugMode ? 0.6 : 0, position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', zIndex: debugMode ? 100 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} playsInline muted autoPlay />
      <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', height: debugMode ? 'auto' : '1px', zIndex: debugMode ? 101 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} />
    </>
  );
};

// --- App Entry ---
export default function GrandTreeApp() {
  const [sceneState, setSceneState] = useState<'CHAOS' | 'FORMED'>('CHAOS');
  const [rotationSpeed, setRotationSpeed] = useState(0);
  const [aiStatus, setAiStatus] = useState("INITIALIZING...");
  const [debugMode, setDebugMode] = useState(false);
  const [customName] = useState('Rea 💗');

  // Store custom name in window for access in 3D scene
  useEffect(() => {
    (window as any).customName = customName;
  }, [customName]);

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
        <Canvas dpr={[1, 2]} gl={{ toneMapping: THREE.ReinhardToneMapping }} shadows>
            <Experience sceneState={sceneState} rotationSpeed={rotationSpeed} customName={customName} />
        </Canvas>
      </div>
      <GestureController onGesture={setSceneState} onMove={setRotationSpeed} onStatus={setAiStatus} debugMode={debugMode} />

      {/* UI - Input Nama */}
      {/* <div style={{ position: 'absolute', top: '20px', left: '40px', zIndex: 10, fontFamily: 'sans-serif' }}>
        <label style={{ display: 'block', color: '#FFD700', fontSize: '12px', marginBottom: '8px', letterSpacing: '2px', textTransform: 'uppercase' }}>
          Nama:
        </label>
        <input
          type="text"
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          placeholder="Masukkan nama"
          style={{
            padding: '10px 15px',
            backgroundColor: 'rgba(0,0,0,0.7)',
            border: '1px solid #FFD700',
            color: '#FFD700',
            fontSize: '14px',
            fontFamily: 'sans-serif',
            borderRadius: '4px',
            minWidth: '200px',
            backdropFilter: 'blur(4px)'
          }}
        />
      </div> */}

      {/* UI - Stats */}
      {/* <div style={{ position: 'absolute', bottom: '30px', left: '40px', color: '#888', zIndex: 10, fontFamily: 'sans-serif', userSelect: 'none' }}>
        <div style={{ marginBottom: '15px' }}>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Top Text</p>
          <p style={{ fontSize: '24px', color: '#FFD700', fontWeight: 'bold', margin: 0 }}>
            {CONFIG.counts.textParticlesTop.toLocaleString()} <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>PARTICLES</span>
          </p>
        </div>
        <div>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Bottom Text</p>
          <p style={{ fontSize: '24px', color: '#FF69B4', fontWeight: 'bold', margin: 0 }}>
            {CONFIG.counts.textParticlesBottom.toLocaleString()} <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>PARTICLES</span>
          </p>
        </div>
      </div> */}

      {/* UI - Buttons */}
      <div style={{ position: 'absolute', bottom: '30px', right: '40px', zIndex: 10, display: 'flex', gap: '10px' }}>
        <button onClick={() => setDebugMode(!debugMode)} style={{ padding: '12px 15px', backgroundColor: debugMode ? '#FFD700' : 'rgba(0,0,0,0.5)', border: '1px solid #FFD700', color: debugMode ? '#000' : '#FFD700', fontFamily: 'sans-serif', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
           {debugMode ? 'HIDE CAMERA' : 'SHOW CAMERA'}
        </button>
        <button onClick={() => setSceneState(s => s === 'CHAOS' ? 'FORMED' : 'CHAOS')} style={{ padding: '12px 30px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255, 23, 68, 0.5)', color: '#FF1744', fontFamily: 'serif', fontSize: '14px', fontWeight: 'bold', letterSpacing: '3px', textTransform: 'uppercase', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
           {sceneState === 'CHAOS' ? 'Show Text' : 'Disperse'}
        </button>
      </div>

      {/* UI - AI Status */}
      <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', color: aiStatus.includes('ERROR') ? '#FF0000' : 'rgba(255, 215, 0, 0.4)', fontSize: '10px', letterSpacing: '2px', zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: '4px' }}>
        {aiStatus}
      </div>
    </div>
  );
}