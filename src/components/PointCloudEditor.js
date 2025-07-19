import React, { useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader";
import * as THREE from "three";

function PointCloudViewer({ pointCloud }) {
  return React.createElement(
    "group",
    null,
    React.createElement("primitive", { object: pointCloud, dispose: null })
  );
}

function PointCloudEditor() {
  const [pointCloud, setPointCloud] = useState(null);
  const inputRef = useRef();

  function handleFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
      const contents = e.target.result;
      const loader = new PLYLoader();
      const geometry = loader.parse(contents);
      geometry.computeVertexNormals();

      const material = new THREE.PointsMaterial({
        size: 0.01,
        vertexColors: geometry.hasAttribute("color"),
      });

      const points = new THREE.Points(geometry, material);
      setPointCloud(points);
    };
    reader.readAsArrayBuffer(file);
  }

  return React.createElement(
    "div",
    { style: { width: "100%", height: "80vh", backgroundColor: "#000" } },
    React.createElement("input", {
      ref: inputRef,
      type: "file",
      accept: ".ply",
      onChange: handleFile,
      style: { margin: "20px", padding: "10px" },
    }),
    React.createElement(
      Canvas,
      { camera: { position: [0, 0, 1], fov: 75 } },
      React.createElement("ambientLight", { intensity: 1 }),
      React.createElement("pointLight", { position: [10, 10, 10] }),
      pointCloud && React.createElement(PointCloudViewer, { pointCloud }),
      React.createElement(OrbitControls, null)
    )
  );
}

export default PointCloudEditor;
