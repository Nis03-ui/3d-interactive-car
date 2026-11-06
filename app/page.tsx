
"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Environment,
  OrbitControls,
  useGLTF,
  useProgress,
} from "@react-three/drei";

import {
  Canvas,
  useFrame,
} from "@react-three/fiber";

import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

/* =========================================================
   TYPES
========================================================= */

type Category = "body" | "wheels" | "interior";

type Finish = "glossy" | "matte" | "metallic";

type Config = {
  bodyColor: string;
  wheelColor: string;
  interiorColor: string;
  finish: Finish;
};

type MeshRecord = {
  uuid: string;
  name: string;
  materials: string[];
};

type MeshMappings = Record<Category, string[]>;

type CameraPreset = {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
};

/* =========================================================
   CONSTANTS
========================================================= */

const INITIAL_CONFIG: Config = {
  bodyColor: "#c62828",
  wheelColor: "#171717",
  interiorColor: "#6b4934",
  finish: "glossy",
};

const COLORS = [
  "#c62828",
  "#1565c0",
  "#eeeeee",
  "#171717",
  "#d4a017",
  "#388e3c",
  "#7b1fa2",
  "#607d8b",
  "#e65100",
  "#90a4ae",
];

const PRESETS: CameraPreset[] = [
  {
    name: "Front",
    position: [0, 2, 10],
    target: [0, 0, 0],
  },
  {
    name: "Side",
    position: [10, 2, 0],
    target: [0, 0, 0],
  },
  {
    name: "Rear",
    position: [0, 2, -10],
    target: [0, 0, 0],
  },
  {
    name: "Top",
    position: [0, 10, 0.5],
    target: [0, 0, 0],
  },
];

const CATEGORY_LABELS: Record<Category, string> = {
  body: "Body",
  wheels: "Wheels",
  interior: "Interior",
};

/* =========================================================
   HELPERS
========================================================= */

function getMaterials(
  material: THREE.Material | THREE.Material[]
): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

function inferMappings(meshes: MeshRecord[]): MeshMappings {
  const mappings: MeshMappings = {
    body: [],
    wheels: [],
    interior: [],
  };

  for (const mesh of meshes) {
    const text = `${mesh.name} ${mesh.materials.join(" ")}`.toLowerCase();

    if (
      /wheel|tire|tyre|rim|brake|disc|hubcap/.test(text)
    ) {
      mappings.wheels.push(mesh.uuid);
    } else if (
      /seat|dashboard|steering|interior|door_panel|carpet|leather/.test(text)
    ) {
      mappings.interior.push(mesh.uuid);
    } else if (
      /body|paint|hood|bonnet|door|bumper|fender|roof|chassis|exterior/.test(text)
    ) {
      mappings.body.push(mesh.uuid);
    }
  }

  return mappings;
}

function getMeshCategory(
  uuid: string,
  mappings: MeshMappings
): Category | null {
  if (mappings.body.includes(uuid)) return "body";
  if (mappings.wheels.includes(uuid)) return "wheels";
  if (mappings.interior.includes(uuid)) return "interior";

  return null;
}

function getMaterialSettings(finish: Finish) {
  switch (finish) {
    case "matte":
      return {
        roughness: 0.85,
        metalness: 0.05,
        clearcoat: 0,
      };

    case "metallic":
      return {
        roughness: 0.25,
        metalness: 0.9,
        clearcoat: 0.7,
      };

    default:
      return {
        roughness: 0.25,
        metalness: 0.25,
        clearcoat: 1,
      };
  }
}

/* =========================================================
   CAR MODEL
========================================================= */

function Car({
  config,
  mappings,
  onMeshesFound,
  onPartSelected,
}: {
  config: Config;
  mappings: MeshMappings;
  onMeshesFound: (meshes: MeshRecord[]) => void;
  onPartSelected: (uuid: string) => void;
}) {
  const { scene } = useGLTF("/models/retro_car.glb");

  // Clone the model hierarchy and materials.
  // This prevents changes to cached GLTF materials.
  const clonedScene = useMemo(() => {
    const cloned = scene.clone(true);

    cloned.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;

        if (Array.isArray(object.material)) {
          object.material = object.material.map((material) =>
            material.clone()
          );
        } else {
          object.material = object.material.clone();
        }
      }
    });

    return cloned;
  }, [scene]);

  // Discover mesh names and materials.
  useEffect(() => {
    const records: MeshRecord[] = [];

    clonedScene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;

      records.push({
        uuid: object.uuid,
        name: object.name || "Unnamed mesh",
        materials: getMaterials(object.material).map(
          (material) => material.name || "Unnamed material"
        ),
      });
    });

    onMeshesFound(records);

    console.table(records);
  }, [clonedScene, onMeshesFound]);

  // Apply configuration to mapped meshes.
  useEffect(() => {
    const settings = getMaterialSettings(config.finish);

    clonedScene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;

      const category = getMeshCategory(object.uuid, mappings);

      if (!category) return;

      const materials = getMaterials(object.material);

      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) {
          continue;
        }

        if (category === "body") {
          material.color.set(config.bodyColor);
          material.roughness = settings.roughness;
          material.metalness = settings.metalness;

          if (material instanceof THREE.MeshPhysicalMaterial) {
            material.clearcoat = settings.clearcoat;
          }
        }

        if (category === "wheels") {
          material.color.set(config.wheelColor);
          material.roughness = 0.65;
          material.metalness = 0.5;
        }

        if (category === "interior") {
          material.color.set(config.interiorColor);
          material.roughness = 0.8;
          material.metalness = 0.05;
        }

        material.needsUpdate = true;
      }
    });
  }, [clonedScene, config, mappings]);

  // Normalize model size and center it.
  const { position, scale } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(clonedScene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const maxDimension = Math.max(size.x, size.y, size.z);

    const normalizedScale = maxDimension > 0
      ? 5 / maxDimension
      : 1;

    return {
      position: new THREE.Vector3(
        -center.x * normalizedScale,
        -center.y * normalizedScale,
        -center.z * normalizedScale
      ),
      scale: normalizedScale,
    };
  }, [clonedScene]);

  return (
    <primitive
      object={clonedScene}
      position={position}
      scale={scale}
     onClick={(event: import("@react-three/fiber").ThreeEvent<MouseEvent>) => {
  event.stopPropagation();
  onPartSelected(event.object.uuid);
}}
    />
  );
}

/* =========================================================
   SCENE COMPONENTS
========================================================= */

function Ground() {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.8, 0]}
      receiveShadow
    >
      <planeGeometry args={[200, 200]} />
      <shadowMaterial opacity={0.3} />
    </mesh>
  );
}

function StudioLights() {
  return (
    <>
      <ambientLight intensity={0.7} />

      <directionalLight
        position={[5, 8, 5]}
        intensity={2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />

      <directionalLight
        position={[-5, 4, -5]}
        intensity={1.2}
      />

      <spotLight
        position={[0, 8, 3]}
        intensity={2}
        angle={0.5}
        penumbra={0.8}
        castShadow
      />
    </>
  );
}

/* =========================================================
   CAMERA ANIMATION
========================================================= */

function CameraAnimator({
  controlsRef,
  destination,
  destinationTarget,
  transitioning,
}: {
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  destination: React.RefObject<THREE.Vector3>;
  destinationTarget: React.RefObject<THREE.Vector3>;
  transitioning: React.RefObject<boolean>;
}) {
  useFrame(({ camera }, delta) => {
    if (!transitioning.current) return;

    const controls = controlsRef.current;
    if (!controls) return;

    const alpha = 1 - Math.exp(-6 * delta);

    camera.position.lerp(destination.current, alpha);

    controls.target.lerp(destinationTarget.current, alpha);

    controls.update();

    const cameraDistance = camera.position.distanceTo(
      destination.current
    );

    const targetDistance = controls.target.distanceTo(
      destinationTarget.current
    );

    if (cameraDistance < 0.015 && targetDistance < 0.015) {
      camera.position.copy(destination.current);
      controls.target.copy(destinationTarget.current);

      controls.enabled = true;
      transitioning.current = false;
    }
  });

  return null;
}

/* =========================================================
   LOADING OVERLAY
========================================================= */

function LoadingOverlay() {
  const { active, progress } = useProgress();

  if (!active) return null;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#090b0f]/90 backdrop-blur-md">
      <div className="flex flex-col items-center gap-4 text-white">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-amber-400" />

        <p className="text-sm tracking-widest">
          LOADING VEHICLE
        </p>

        <span className="text-sm text-amber-400">
          {Math.round(progress)}%
        </span>
      </div>
    </div>
  );
}

/* =========================================================
   COLOR PICKER
========================================================= */

function ColorPicker({
  selectedColor,
  onChange,
}: {
  selectedColor: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-4">
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Select ${color}`}
          onClick={() => onChange(color)}
          className={`aspect-square rounded-full border-2 transition hover:scale-110 ${
            selectedColor.toLowerCase() === color.toLowerCase()
              ? "border-amber-400 ring-2 ring-amber-400/40 ring-offset-2 ring-offset-[#11151b]"
              : "border-white/20"
          }`}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

/* =========================================================
   MAIN PAGE
========================================================= */

export default function Home() {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  const destination = useRef(new THREE.Vector3(0, 2, 10));
  const destinationTarget = useRef(new THREE.Vector3(0, 0, 0));

  const transitioning = useRef(false);

  const [config, setConfig] = useState<Config>(INITIAL_CONFIG);

  const [meshes, setMeshes] = useState<MeshRecord[]>([]);

  const [mappings, setMappings] = useState<MeshMappings>({
    body: [],
    wheels: [],
    interior: [],
  });

  const [activeCategory, setActiveCategory] =
    useState<Category>("body");

  const [selectedPart, setSelectedPart] = useState<string | null>(
    null
  );

  const [developerPanel, setDeveloperPanel] = useState(false);

  const [summaryPanel, setSummaryPanel] = useState(false);

  const handleMeshesFound = useCallback((foundMeshes: MeshRecord[]) => {
    setMeshes(foundMeshes);
    setMappings(inferMappings(foundMeshes));
  }, []);

  const handlePartSelected = useCallback((uuid: string) => {
    setSelectedPart(uuid);
  }, []);

  function updateConfig<K extends keyof Config>(
    key: K,
    value: Config[K]
  ) {
    setConfig((previous) => ({
      ...previous,
      [key]: value,
    }));
  }

  function changeCamera(preset: CameraPreset) {
    const controls = controlsRef.current;

    if (!controls) return;

    transitioning.current = true;
    controls.enabled = false;

    destination.current.set(...preset.position);
    destinationTarget.current.set(...preset.target);
  }

  function resetCamera() {
    const controls = controlsRef.current;

    if (!controls) return;

    changeCamera(PRESETS[0]);
  }

  function toggleMeshMapping(uuid: string) {
    setMappings((previous) => {
      const current = previous[activeCategory];

      const updated = current.includes(uuid)
        ? current.filter((id) => id !== uuid)
        : [...current, uuid];

      return {
        ...previous,
        [activeCategory]: updated,
      };
    });
  }

  const selectedMesh = meshes.find(
    (mesh) => mesh.uuid === selectedPart
  );

  const selectedCategory = selectedPart
    ? getMeshCategory(selectedPart, mappings)
    : null;

  return (
    <main className="min-h-screen bg-[#090b0f] text-white">
      {/* HEADER */}

      <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-[#101319] px-5 py-4 sm:px-10 lg:px-16">
        <div>
          <h1 className="text-xl font-black tracking-[0.2em]">
            <span className="text-amber-400">AUTO</span>
            STUDIO
          </h1>

          <p className="mt-1 text-[10px] tracking-[0.25em] text-gray-500">
            INTERACTIVE CONFIGURATOR
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="h-2 w-2 rounded-full bg-green-400" />
          3D CONFIGURATION STUDIO
        </div>
      </header>

      {/* MAIN WORKSPACE */}

      <section className="mx-auto grid max-w-[1600px] grid-cols-1 gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-12">

        {/* VIEWER */}

        <div className="relative min-h-[480px] overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_center,#303741_0%,#171c24_45%,#0b0e13_100%)] lg:min-h-[680px]">

          <Canvas
            shadows
            dpr={[1, 2]}
            camera={{
              position: [0, 2, 10],
              fov: 45,
              near: 0.1,
              far: 100,
            }}
            onPointerMissed={() => setSelectedPart(null)}
          >
            <Suspense fallback={null}>
              <Environment preset="studio" />

              <StudioLights />

              <Car
                config={config}
                mappings={mappings}
                onMeshesFound={handleMeshesFound}
                onPartSelected={handlePartSelected}
              />

              <Ground />

              <OrbitControls
                ref={controlsRef}
                makeDefault
                enableDamping
                dampingFactor={0.05}
                enablePan={false}
                minDistance={3}
                maxDistance={12}
                minPolarAngle={0.05}
                maxPolarAngle={Math.PI / 2}
              />

              <CameraAnimator
                controlsRef={controlsRef}
                destination={destination}
                destinationTarget={destinationTarget}
                transitioning={transitioning}
              />
            </Suspense>
          </Canvas>

          <LoadingOverlay />

          {/* CAMERA CONTROLS */}

          <div className="absolute left-3 top-3 z-20 flex flex-wrap gap-2 sm:left-5 sm:top-5">
            {PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => changeCamera(preset)}
                className="rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-xs text-gray-200 backdrop-blur-md transition hover:border-amber-400 hover:bg-amber-400/10 hover:text-amber-300"
              >
                {preset.name}
              </button>
            ))}

            <button
              type="button"
              onClick={resetCamera}
              className="rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-xs text-gray-200 backdrop-blur-md transition hover:border-amber-400"
            >
              Reset
            </button>
          </div>

          {/* VIEWER INFORMATION */}

          <div className="pointer-events-none absolute bottom-5 left-5 z-10">
            <p className="text-[10px] tracking-[0.3em] text-amber-400">
              VEHICLE PREVIEW
            </p>

            <h2 className="mt-1 text-xl font-bold">
              Retro Collection
            </h2>

            <p className="mt-1 text-xs text-gray-400">
              Drag to rotate · Scroll to zoom
            </p>
          </div>

          <div className="absolute bottom-5 right-5 z-10">
            <button
              type="button"
              onClick={() => setDeveloperPanel((value) => !value)}
              className="rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-xs text-gray-300 backdrop-blur-md transition hover:border-amber-400"
            >
              {developerPanel ? "Hide mesh tools" : "Mesh tools"}
            </button>
          </div>
        </div>

        {/* CONFIGURATION PANEL */}

        <aside className="rounded-2xl border border-white/10 bg-[#11151b] p-5 sm:p-6">
          <div className="mb-6">
            <p className="text-[10px] tracking-[0.25em] text-amber-400">
              PERSONALIZATION
            </p>

            <h2 className="mt-2 text-2xl font-bold">
              Build your car
            </h2>

            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              Customize the exterior, wheels and interior.
            </p>
          </div>

          {/* CATEGORY TABS */}

          <div className="mb-7 grid grid-cols-3 gap-2">
            {(
              ["body", "wheels", "interior"] as Category[]
            ).map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
                className={`rounded-lg border px-2 py-3 text-xs font-semibold transition ${
                  activeCategory === category
                    ? "border-amber-400 bg-amber-400/10 text-amber-300"
                    : "border-white/10 bg-[#1a2029] text-gray-400 hover:border-white/30"
                }`}
              >
                {CATEGORY_LABELS[category]}
              </button>
            ))}
          </div>

          {/* BODY CONFIGURATION */}

          {activeCategory === "body" && (
            <div className="space-y-7">
              <div>
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">
                    Exterior color
                  </h3>

                  <span className="text-xs text-gray-500">
                    {config.bodyColor}
                  </span>
                </div>

                <ColorPicker
                  selectedColor={config.bodyColor}
                  onChange={(color) =>
                    updateConfig("bodyColor", color)
                  }
                />

                <div className="mt-5">
                  <label className="mb-2 block text-xs text-gray-400">
                    Custom color
                  </label>

                  <input
                    type="color"
                    value={config.bodyColor}
                    onChange={(event) =>
                      updateConfig("bodyColor", event.target.value)
                    }
                    className="h-11 w-full cursor-pointer rounded-lg border border-white/10 bg-[#1a2029] p-1"
                  />
                </div>
              </div>

              <div>
                <h3 className="mb-4 text-sm font-semibold">
                  Paint finish
                </h3>

                <div className="grid grid-cols-3 gap-2">
                  {(
                    ["glossy", "matte", "metallic"] as Finish[]
                  ).map((finish) => (
                    <button
                      key={finish}
                      type="button"
                      onClick={() => updateConfig("finish", finish)}
                      className={`rounded-lg border px-2 py-3 text-xs capitalize transition ${
                        config.finish === finish
                          ? "border-amber-400 bg-amber-400/10 text-amber-300"
                          : "border-white/10 bg-[#1a2029] text-gray-400 hover:border-white/30"
                      }`}
                    >
                      {finish}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* WHEEL CONFIGURATION */}

          {activeCategory === "wheels" && (
            <div>
              <h3 className="mb-4 text-sm font-semibold">
                Wheel color
              </h3>

              <ColorPicker
                selectedColor={config.wheelColor}
                onChange={(color) =>
                  updateConfig("wheelColor", color)
                }
              />

              <div className="mt-5">
                <label className="mb-2 block text-xs text-gray-400">
                  Custom color
                </label>

                <input
                  type="color"
                  value={config.wheelColor}
                  onChange={(event) =>
                    updateConfig("wheelColor", event.target.value)
                  }
                  className="h-11 w-full cursor-pointer rounded-lg border border-white/10 bg-[#1a2029] p-1"
                />
              </div>
            </div>
          )}

          {/* INTERIOR CONFIGURATION */}

          {activeCategory === "interior" && (
            <div>
              <h3 className="mb-4 text-sm font-semibold">
                Interior color
              </h3>

              <ColorPicker
                selectedColor={config.interiorColor}
                onChange={(color) =>
                  updateConfig("interiorColor", color)
                }
              />

              <div className="mt-5">
                <label className="mb-2 block text-xs text-gray-400">
                  Custom color
                </label>

                <input
                  type="color"
                  value={config.interiorColor}
                  onChange={(event) =>
                    updateConfig("interiorColor", event.target.value)
                  }
                  className="h-11 w-full cursor-pointer rounded-lg border border-white/10 bg-[#1a2029] p-1"
                />
              </div>
            </div>
          )}

          {/* SELECTED PART */}

          <div className="mt-8 rounded-xl border border-white/10 bg-[#171c24] p-4">
            <p className="text-[10px] tracking-widest text-gray-500">
              SELECTED COMPONENT
            </p>

            <p className="mt-2 break-all text-sm font-semibold">
              {selectedMesh?.name ?? "No component selected"}
            </p>

            <p className="mt-1 text-xs text-gray-500">
              Category: {selectedCategory ?? "Not assigned"}
            </p>
          </div>

          {/* CONFIGURATION SUMMARY */}

          <button
            type="button"
            onClick={() => setSummaryPanel((value) => !value)}
            className="mt-6 flex w-full items-center justify-between border-t border-white/10 pt-5 text-sm font-semibold"
          >
            Configuration summary

            <span className="text-amber-400">
              {summaryPanel ? "−" : "+"}
            </span>
          </button>

          {summaryPanel && (
            <div className="mt-4 space-y-3 text-xs">
              <div className="flex justify-between gap-3 text-gray-400">
                <span>Body</span>
                <span className="font-medium text-white">
                  {config.bodyColor}
                </span>
              </div>

              <div className="flex justify-between gap-3 text-gray-400">
                <span>Wheels</span>
                <span className="font-medium text-white">
                  {config.wheelColor}
                </span>
              </div>

              <div className="flex justify-between gap-3 text-gray-400">
                <span>Interior</span>
                <span className="font-medium text-white">
                  {config.interiorColor}
                </span>
              </div>

              <div className="flex justify-between gap-3 text-gray-400">
                <span>Finish</span>
                <span className="font-medium capitalize text-white">
                  {config.finish}
                </span>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setConfig(INITIAL_CONFIG)}
            className="mt-7 w-full rounded-lg border border-white/15 bg-[#1a2029] py-3 text-xs font-semibold text-gray-300 transition hover:border-amber-400 hover:text-amber-300"
          >
            Reset configuration
          </button>
        </aside>

        {/* DEVELOPER MESH MAPPING */}

        {developerPanel && (
          <section className="col-span-full rounded-2xl border border-white/10 bg-[#11151b] p-5 sm:p-7">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] tracking-[0.25em] text-amber-400">
                  DEVELOPER TOOLS
                </p>

                <h2 className="mt-2 text-xl font-bold">
                  Mesh mapping
                </h2>

                <p className="mt-1 text-xs text-gray-500">
                  Assign model meshes to customization categories.
                </p>
              </div>

              <span className="rounded-lg bg-white/5 px-3 py-2 text-xs text-gray-400">
                {meshes.length} meshes discovered
              </span>
            </div>

            <div className="mb-5 flex flex-wrap gap-2">
              {(
                ["body", "wheels", "interior"] as Category[]
              ).map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveCategory(category)}
                  className={`rounded-lg border px-4 py-2 text-xs capitalize transition ${
                    activeCategory === category
                      ? "border-amber-400 bg-amber-400/10 text-amber-300"
                      : "border-white/10 bg-[#1a2029] text-gray-400"
                  }`}
                >
                  {category} ({mappings[category].length})
                </button>
              ))}
            </div>

            {meshes.length === 0 ? (
              <p className="text-sm text-gray-500">
                Waiting for model mesh information...
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {meshes.map((mesh) => {
                  const checked = mappings[activeCategory].includes(
                    mesh.uuid
                  );

                  return (
                    <label
                      key={mesh.uuid}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                        checked
                          ? "border-amber-400/50 bg-amber-400/5"
                          : "border-white/10 bg-[#1a2029] hover:border-white/30"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMeshMapping(mesh.uuid)}
                        className="mt-1 accent-amber-400"
                      />

                      <span className="min-w-0">
                        <span className="block break-all text-xs font-semibold text-gray-200">
                          {mesh.name}
                        </span>

                        <span className="mt-1 block break-all text-[10px] text-gray-500">
                          {mesh.materials.join(", ")}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setMappings(inferMappings(meshes))}
                className="rounded-lg border border-white/15 px-4 py-2 text-xs text-gray-300 transition hover:border-amber-400"
              >
                Re-run automatic mapping
              </button>

              <button
                type="button"
                onClick={() =>
                  setMappings({
                    body: [],
                    wheels: [],
                    interior: [],
                  })
                }
                className="rounded-lg border border-white/15 px-4 py-2 text-xs text-gray-300 transition hover:border-red-400"
              >
                Clear mappings
              </button>
            </div>
          </section>
        )}
      </section>

      {/* FOOTER */}

      <footer className="border-t border-white/10 px-5 py-6 text-center text-[10px] tracking-[0.2em] text-gray-600">
        AUTO STUDIO · INTERACTIVE 3D CONFIGURATION
      </footer>
    </main>
  );
}

useGLTF.preload("/models/retro_car.glb");
