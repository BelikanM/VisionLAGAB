import React, { useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader";
import * as THREE from "three";

function PointCloudViewer({ pointCloud, annotations }) {
  return (
    <group>
      <primitive object={pointCloud} dispose={null} />
      {annotations.map((anno, idx) => {
        if (anno.type === "sphere") {
          return (
            <mesh key={idx} position={anno.position}>
              <sphereGeometry args={[anno.radius || 0.02, 16, 16]} />
              <meshBasicMaterial color={anno.color || "red"} />
            </mesh>
          );
        }
        return null;
      })}
    </group>
  );
}

function PointCloudEditor() {
  const [pointCloud, setPointCloud] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const inputRef = useRef();
  const scriptRef = useRef();

  function handleFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
      const contents = e.target.result;
      const loader = new PLYLoader();
      const geometry = loader.parse(contents);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();

      const material = new THREE.PointsMaterial({
        size: 0.01,
        vertexColors: geometry.hasAttribute("color"),
      });

      const points = new THREE.Points(geometry, material);
      setPointCloud(points);
    };
    reader.readAsArrayBuffer(file);
  }

  function handleScriptRun() {
    try {
      const commands = JSON.parse(scriptRef.current.value);
      if (!Array.isArray(commands)) throw new Error("Script must be a JSON array.");
      setAnnotations(commands);
    } catch (err) {
      alert("Erreur dans le script JSON : " + err.message);
    }
  }

  async function runInferenceWithScript() {
    try {
      const script = JSON.parse(scriptRef.current.value);
      if (!script.model || !script.actions) throw new Error("Script invalide");

      const tf = await import("@tensorflow/tfjs");
      const model = await tf.loadGraphModel(script.model);

      const positions = pointCloud.geometry.attributes.position.array;
      const inputs = tf.tensor(positions, [positions.length / 3, 3]);

      const result = await model.predict(inputs);
      const outputData = await result.array();

      const newAnnotations = [];
      outputData.forEach((val, idx) => {
        if (val[0] > 0.5) {
          const pos = [
            positions[idx * 3],
            positions[idx * 3 + 1],
            positions[idx * 3 + 2],
          ];
          newAnnotations.push({
            type: "sphere",
            position: pos,
            radius: 0.015,
            color: script.actions[0]?.color || "red",
          });
        }
      });

      setAnnotations(newAnnotations);
    } catch (e) {
      alert("Erreur IA : " + e.message);
    }
  }

  return (
    <div style={{ width: "100%", height: "100vh", backgroundColor: "#111" }}>
      <div style={{ padding: 10 }}>
        <input
          ref={inputRef}
          type="file"
          accept=".ply"
          onChange={handleFile}
          style={{ marginRight: "10px", padding: "5px" }}
        />
        <button onClick={handleScriptRun} style={{ padding: "5px 15px" }}>
          Exécuter Script
        </button>
        <button onClick={runInferenceWithScript} style={{ padding: "5px 15px", marginLeft: 10 }}>
          Lancer IA
        </button>
        <textarea
          ref={scriptRef}
          placeholder={`{
  "model": "https://url-de-ton-model/model.json",
  "actions": [{"type": "highlight_anomalies", "color": "yellow"}]
}`}
          rows={6}
          style={{ width: "100%", marginTop: 10 }}
        />
      </div>

      <Canvas camera={{ position: [0, 0, 1], fov: 75 }}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />
        {pointCloud && (
          <PointCloudViewer pointCloud={pointCloud} annotations={annotations} />
        )}
        <OrbitControls />
      </Canvas>
    </div>
  );
}

export default PointCloudEditor;
