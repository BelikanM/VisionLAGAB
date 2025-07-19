import React, { useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader";
import * as THREE from "three";
import { FaFileUpload, FaPlay, FaRobot, FaSun, FaMoon } from "react-icons/fa";

function PointCloudViewer({ pointCloud, annotations }) {
  return (
    <group>
      <primitive object={pointCloud} dispose={null} />
      {annotations.map((anno, idx) => {
        if (anno.type === "sphere") {
          return (
            <mesh key={idx} position={anno.position}>
              <sphereGeometry args={[anno.radius || 0.02, 16, 16]} />
              <meshBasicMaterial color={anno.color || "#ff00ff"} />
            </mesh>
          );
        } else if (anno.type === "line") {
          const points = anno.points.map((p) => new THREE.Vector3(...p));
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          return (
            <line key={idx}>
              <bufferGeometry attach="geometry" {...geometry} />
              <lineBasicMaterial
                color={anno.color || "#00ff00"}
                linewidth={anno.thickness || 0.01}
              />
            </line>
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
  const [isDarkMode, setIsDarkMode] = useState(true);
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

      const newAnnotations = [];
      let validPoints = [];

      commands.forEach((cmd) => {
        if (cmd.type === "measure") {
          if (pointCloud) {
            const box = pointCloud.geometry.boundingBox;
            const dimensions = {
              width: (box.max.x - box.min.x).toFixed(3),
              height: (box.max.y - box.min.y).toFixed(3),
              depth: (box.max.z - box.min.z).toFixed(3),
            };
            alert(`Dimensions: ${JSON.stringify(dimensions)}`);
          }
        } else if (cmd.type === "highlight") {
          newAnnotations.push({
            type: "sphere",
            position: cmd.position || [0, 0, 0],
            radius: cmd.radius || 0.015,
            color: cmd.color || "#00ff00",
          });
        } else if (cmd.type === "analyze_anomalies") {
          if (pointCloud) {
            const positions = pointCloud.geometry.attributes.position.array;
            const points = [];
            for (let i = 0; i < positions.length; i += 3) {
              points.push([
                positions[i],
                positions[i + 1],
                positions[i + 2],
              ]);
            }

            // Simple linear regression for curve fitting (y = mx + b)
            const xValues = points.map((p) => p[0]);
            const yValues = points.map((p) => p[1]);
            const n = xValues.length;
            const xMean = xValues.reduce((a, b) => a + b, 0) / n;
            const yMean = yValues.reduce((a, b) => a + b, 0) / n;
            let num = 0, denom = 0;
            for (let i = 0; i < n; i++) {
              num += (xValues[i] - xMean) * (yValues[i] - yMean);
              denom += (xValues[i] - xMean) ** 2;
            }
            const m = num / denom;
            const b = yMean - m * xMean;

            // Detect anomalies based on distance from the fitted line
            points.forEach((point, idx) => {
              const expectedY = m * point[0] + b;
              const distance = Math.abs(point[1] - expectedY);
              if (distance > (cmd.threshold || 0.05)) {
                newAnnotations.push({
                type: "sphere",
                position: point,
                radius: 0.015,
                color: cmd.color || "#ff00ff",
              });
              } else {
                validPoints.push(point);
              }
            });
          }
        } else if (cmd.type === "draw_lines") {
          if (validPoints.length > 1) {
            newAnnotations.push({
              type: "line",
              points: validPoints,
              color: cmd.color || "#00ff00",
              thickness: cmd.thickness || 0.01,
            });
          }
        }
      });
      setAnnotations(newAnnotations);
    } catch (err) {
      alert("Erreur dans le script JSON : " + err.message);
    }
  }

  async function runInferenceWithScript() {
    try {
      const script = JSON.parse(scriptRef.current.value);
      if (!script.actions) throw new Error("Script invalide");

      const positions = pointCloud.geometry.attributes.position.array;
      const outputData = Array.from({ length: positions.length / 3 }, () =>
        Math.random() > 0.5 ? [1] : [0]
      );

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
            color: script.actions[0]?.color || "#ff00ff",
          });
        }
      });

      setAnnotations(newAnnotations);
    } catch (e) {
      alert("Erreur IA : " + e.message);
    }
  }

  function toggleTheme() {
    setIsDarkMode(!isDarkMode);
  }

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        backgroundColor: isDarkMode ? "#1a0033" : "#e6ccff",
        color: isDarkMode ? "#00ff00" : "#330066",
        transition: "all 0.3s ease",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "10px",
          display: "flex",
          flexWrap: "wrap",
          gap: "10px",
          maxWidth: "100%",
          boxSizing: "border-box",
        }}
      >
        <label
          style={{
            padding: "8px 12px",
            backgroundColor: "#6600cc",
            color: "#00ff00",
            borderRadius: "5px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "14px",
            minWidth: "120px",
          }}
        >
          <FaFileUpload /> Importer PLY
          <input
            ref={inputRef}
            type="file"
            accept=".ply"
            onChange={handleFile}
            style={{ display: "none" }}
          />
        </label>
        <button
          onClick={handleScriptRun}
          style={{
            padding: "8px 12px",
            backgroundColor: "#00ff00",
            color: "#330066",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "14px",
            minWidth: "120px",
          }}
        >
          <FaPlay /> Exécuter Script
        </button>
        <button
          onClick={runInferenceWithScript}
          style={{
            padding: "8px 12px",
            backgroundColor: "#ff00ff",
            color: "#00ff00",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "14px",
            minWidth: "120px",
          }}
        >
          <FaRobot /> Lancer IA
        </button>
        <button
          onClick={toggleTheme}
          style={{
            padding: "8px 12px",
            backgroundColor: isDarkMode ? "#00cc00" : "#6600cc",
            color: isDarkMode ? "#ff00ff" : "#00ff00",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "14px",
            minWidth: "120px",
          }}
        >
          {isDarkMode ? <FaSun /> : <FaMoon />}
          {isDarkMode ? "Mode Clair" : "Mode Sombre"}
        </button>
      </div>
      <textarea
        ref={scriptRef}
        placeholder={`[
  {"type": "analyze_anomalies", "threshold": 0.05, "color": "#ff00ff"},
  {"type": "draw_lines", "color": "#00ff00", "thickness": 0.01}
]`}
        rows={6}
        style={{
          width: "calc(100% - 20px)",
          margin: "10px",
          padding: "10px",
          backgroundColor: isDarkMode ? "#330066" : "#cc99ff",
          color: isDarkMode ? "#00ff00" : "#330066",
          border: "2px solid #ff00ff",
          borderRadius: "5px",
          boxSizing: "border-box",
          resize: "vertical",
        }}
      />
      <style>
        {`
          @media (max-width: 600px) {
            button, label {
              font-size: 12px !important;
              padding: 6px 10px !important;
              min-width: 100px !important;
            }
            textarea {
              font-size: 14px !important;
            }
          }
        `}
      </style>
      <Canvas
        style={{ width: "100%", height: "calc(100% - 150px)" }}
        camera={{ position: [0, 0, 1], fov: 75 }}
      >
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
