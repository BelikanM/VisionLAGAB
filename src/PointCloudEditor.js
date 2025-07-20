import React, { useRef, useState, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { FaFileUpload, FaPlay, FaRobot, FaSun, FaMoon, FaImage, FaVideo, FaStop, FaDownload, FaEye, FaEyeSlash, FaClipboard } from "react-icons/fa";

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
  const [isStreaming, setIsStreaming] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const inputRef = useRef();
  const imageInputRef = useRef();
  const videoRef = useRef();
  const scriptRef = useRef();
  const streamIntervalRef = useRef(null);

  const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`].slice(-50)); // Limiter à 50 logs
    console.log(`[${timestamp}] ${message}`);
  };

  const copyLogs = () => {
    navigator.clipboard.writeText(logs.join("\n"))
      .then(() => addLog("Logs copiés dans le presse-papiers"))
      .catch((err) => addLog(`Erreur lors de la copie des logs : ${err.message}`));
  };

  async function handleFile(event, isImage = false) {
    const file = event.target.files[0];
    if (!file) {
      addLog("Aucun fichier sélectionné");
      return;
    }

    setIsLoading(true);
    addLog(`Chargement du fichier : ${file.name}`);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const endpoint = isImage ? "http://localhost:5000/upload_image" : "http://localhost:5000/upload";
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMsg = `Erreur serveur : ${errorData.error || response.statusText}`;
        setErrorMessage(errorMsg);
        addLog(errorMsg);
        setIsLoading(false);
        return;
      }

      await handlePlyResponse(response);
      setIsLoading(false);
    } catch (err) {
      const errorMsg = `Erreur lors du chargement du fichier : ${err.message}`;
      setErrorMessage(errorMsg);
      addLog(errorMsg);
      setIsLoading(false);
    }
  }

  async function handlePlyResponse(response) {
    try {
      addLog(`Réponse reçue, content-type : ${response.headers.get("content-type")}`);
      const contentType = response.headers.get("content-type");
      if (contentType.includes("application/json")) {
        const data = await response.json();
        if (data.error) {
          const errorMsg = `Erreur serveur : ${data.error}`;
          setErrorMessage(errorMsg);
          addLog(errorMsg);
          return;
        }
        addLog(`Données JSON reçues : ${JSON.stringify(data).slice(0, 100)}...`);
        updatePointCloud(data);
      } else if (contentType.includes("text/plain")) {
        const blob = await response.blob();
        const text = await blob.text();
        addLog(`Fichier PLY reçu, taille : ${text.length} caractères`);

        const lines = text.split("\n");
        let positions = [];
        let colors = [];
        let headerEnd = false;
        let vertexCount = 0;

        for (let line of lines) {
          if (line.startsWith("element vertex")) {
            vertexCount = parseInt(line.split(" ")[2]);
            addLog(`Nombre de sommets attendu : ${vertexCount}`);
          }
          if (line.startsWith("end_header")) {
            headerEnd = true;
            continue;
          }
          if (headerEnd) {
            const parts = line.trim().split(" ");
            if (parts.length >= 6) {
              const x = parseFloat(parts[0]);
              const y = parseFloat(parts[1]);
              const z = parseFloat(parts[2]);
              if (isNaN(x) || isNaN(y) || isNaN(z)) {
                addLog(`Point invalide détecté : ${line}`);
                continue;
              }
              positions.push([x, y, z]);
              colors.push([parseInt(parts[3]) / 255, parseInt(parts[4]) / 255, parseInt(parts[5]) / 255]);
            }
          }
        }

        if (positions.length === 0) {
          const errorMsg = "Aucun point valide trouvé dans le fichier PLY";
          setErrorMessage(errorMsg);
          addLog(errorMsg);
          return;
        }

        addLog(`Points parsés : ${positions.length}, couleurs : ${colors.length}`);

        // Récupérer les annotations
        try {
          const annotationsResponse = await fetch("http://localhost:5000/get_annotations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          const annotationsData = await annotationsResponse.json();
          if (annotationsData.error) {
            const errorMsg = `Erreur lors de la récupération des annotations : ${annotationsData.error}`;
            setErrorMessage(errorMsg);
            addLog(errorMsg);
          } else {
            addLog(`Annotations reçues : ${annotationsData.annotations.length}`);
            updatePointCloud({
              positions,
              colors,
              annotations: annotationsData.annotations || [],
            });
          }
        } catch (err) {
          addLog(`Erreur lors de la requête des annotations : ${err.message}`);
        }
      } else {
        const errorMsg = `Type de contenu inattendu : ${contentType}`;
        setErrorMessage(errorMsg);
        addLog(errorMsg);
      }
    } catch (err) {
      const errorMsg = `Erreur lors du parsing du PLY : ${err.message}`;
      setErrorMessage(errorMsg);
      addLog(errorMsg);
    }
  }

  function updatePointCloud(data) {
    if (!data.positions || data.positions.length === 0) {
      const errorMsg = "Aucun point valide reçu dans le nuage de points";
      setErrorMessage(errorMsg);
      addLog(errorMsg);
      return;
    }

    addLog(`Création du nuage de points avec ${data.positions.length} points`);

    try {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(data.positions.flat());
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

      if (data.colors && data.colors.length === data.positions.length) {
        const colors = new Float32Array(data.colors.flat());
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        addLog("Couleurs appliquées au nuage de points");
      }

      geometry.computeVertexNormals();
      geometry.computeBoundingBox();

      const material = new THREE.PointsMaterial({
        size: 0.01,
        vertexColors: data.colors && data.colors.length === data.positions.length ? true : false,
        color: data.colors ? null : "#ffffff",
      });

      const points = new THREE.Points(geometry, material);
      setPointCloud(points);
      setAnnotations(data.annotations || []);
      setErrorMessage(data.annotations.length === 0 ? "Aucune anomalie détectée." : null);
      addLog(`Nuage de points rendu, annotations : ${data.annotations.length}`);

      // Sauvegarder dans localStorage
      localStorage.setItem("pointCloudData", JSON.stringify({
        positions: data.positions,
        colors: data.colors,
        annotations: data.annotations || [],
      }));
      addLog("Données sauvegardées dans localStorage");
    } catch (err) {
      const errorMsg = `Erreur lors de la création du nuage de points : ${err.message}`;
      setErrorMessage(errorMsg);
      addLog(errorMsg);
    }
  }

  async function startVideoStream() {
    try {
      addLog("Tentative d'accès à la caméra arrière");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 256, height: 192 },
      });
      videoRef.current.srcObject = stream;
      videoRef.current.style.display = showVideo ? "block" : "none";
      setIsStreaming(true);
      addLog("Caméra arrière ouverte");

      streamIntervalRef.current = setInterval(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = videoRef.current.videoWidth || 256;
        canvas.height = videoRef.current.videoHeight || 192;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(async (blob) => {
          setIsLoading(true);
          addLog("Envoi d'une frame vidéo au backend");
          const formData = new FormData();
          formData.append("file", blob, "frame.jpg");

          try {
            const response = await fetch("http://localhost:5000/upload_image", {
              method: "POST",
              body: formData,
            });
            await handlePlyResponse(response);
            setIsLoading(false);
          } catch (err) {
            const errorMsg = `Erreur lors du streaming : ${err.message}`;
            setErrorMessage(errorMsg);
            addLog(errorMsg);
            setIsLoading(false);
          }
        }, "image/jpeg");
      }, 500); // Intervalle de 500 ms
    } catch (err) {
      const errorMsg = `Erreur lors de l'accès à la caméra arrière : ${err.message}. Vérifiez les permissions et la disponibilité de la caméra.`;
      setErrorMessage(errorMsg);
      addLog(errorMsg);
    }
  }

  function stopVideoStream() {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      videoRef.current.style.display = "none";
    }
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
    }
    setIsStreaming(false);
    setShowVideo(false);
    setIsLoading(false);
    addLog("Streaming vidéo arrêté");
  }

  function toggleVideoDisplay() {
    setShowVideo(!showVideo);
    if (videoRef.current) {
      videoRef.current.style.display = showVideo ? "none" : "block";
    }
    addLog(`Fenêtre vidéo : ${showVideo ? "masquée" : "affichée"}`);
  }

  function loadFromLocalStorage() {
    addLog("Tentative de chargement depuis localStorage");
    const data = localStorage.getItem("pointCloudData");
    if (data) {
      try {
        const parsedData = JSON.parse(data);
        addLog("Données récupérées depuis localStorage");
        updatePointCloud(parsedData);
      } catch (err) {
        const errorMsg = `Erreur lors du chargement depuis localStorage : ${err.message}`;
        setErrorMessage(errorMsg);
        addLog(errorMsg);
      }
    } else {
      const errorMsg = "Aucun nuage de points trouvé dans localStorage.";
      setErrorMessage(errorMsg);
      addLog(errorMsg);
    }
  }

  async function handleScriptRun() {
    try {
      addLog("Exécution du script JSON");
      const commands = JSON.parse(scriptRef.current.value);
      if (!Array.isArray(commands)) throw new Error("Script doit être un tableau JSON.");

      const response = await fetch("http://localhost:5000/run_script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commands, positions: pointCloud ? pointCloud.geometry.attributes.position.array : [] }),
      });
      const data = await response.json();

      if (data.error) {
        const errorMsg = `Erreur : ${data.error}`;
        setErrorMessage(errorMsg);
        addLog(errorMsg);
        return;
      }

      setAnnotations(data.annotations || []);
      addLog(`Script exécuté, annotations reçues : ${data.annotations.length}`);
      if (data.measurements) {
        alert(`Dimensions : ${JSON.stringify(data.measurements)}`);
        addLog(`Métriques reçues : ${JSON.stringify(data.measurements)}`);
      }
    } catch (err) {
      const errorMsg = `Erreur dans le script JSON : ${err.message}`;
      setErrorMessage(errorMsg);
      addLog(errorMsg);
    }
  }

  async function runInferenceWithScript() {
    try {
      addLog("Lancement de l'inférence IA");
      const script = JSON.parse(scriptRef.current.value);
      if (!script.actions) throw new Error("Script invalide");

      const response = await fetch("http://localhost:5000/run_inference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, positions: pointCloud ? pointCloud.geometry.attributes.position.array : [] }),
      });
      const data = await response.json();

      if (data.error) {
        const errorMsg = `Erreur IA : ${data.error}`;
        setErrorMessage(errorMsg);
        addLog(errorMsg);
        return;
      }

      setAnnotations(data.annotations || []);
      addLog(`Inférence IA terminée, annotations reçues : ${data.annotations.length}`);
    } catch (err) {
      const errorMsg = `Erreur IA : ${err.message}`;
      setErrorMessage(errorMsg);
      addLog(errorMsg);
    }
  }

  function toggleTheme() {
    setIsDarkMode(!isDarkMode);
    addLog(`Mode changé : ${isDarkMode ? "clair" : "sombre"}`);
  }

  useEffect(() => {
    addLog("Composant PointCloudEditor monté");
    return () => {
      stopVideoStream();
      addLog("Composant PointCloudEditor démonté");
    };
  }, []);

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
        position: "relative",
      }}
    >
      {errorMessage && (
        <div
          style={{
            position: "absolute",
            top: "10px",
            left: "50%",
            transform: "translateX(-50%)",
            backgroundColor: "#ff3333",
            color: "#ffffff",
            padding: "10px",
            borderRadius: "5px",
            zIndex: 1000,
          }}
        >
          {errorMessage}
        </div>
      )}
      {isLoading && (
        <div
          style={{
            position: "absolute",
            top: "50px",
            left: "50%",
            transform: "translateX(-50%)",
            backgroundColor: "#00ccff",
            color: "#ffffff",
            padding: "10px",
            borderRadius: "5px",
            zIndex: 1000,
          }}
        >
          Traitement en cours...
        </div>
      )}
      {showLogs && (
        <div
          style={{
            position: "absolute",
            bottom: "10px",
            right: "10px",
            width: "300px",
            maxHeight: "200px",
            backgroundColor: isDarkMode ? "#330066" : "#cc99ff",
            color: isDarkMode ? "#00ff00" : "#330066",
            border: "2px solid #ff00ff",
            borderRadius: "5px",
            padding: "10px",
            overflowY: "auto",
            zIndex: 1000,
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: "5px" }}>Logs</div>
          {logs.map((log, idx) => (
            <div key={idx} style={{ fontSize: "12px", marginBottom: "2px" }}>
              {log}
            </div>
          ))}
          <button
            onClick={copyLogs}
            style={{
              marginTop: "10px",
              padding: "5px",
              backgroundColor: "#00ff00",
              color: "#330066",
              border: "none",
              borderRadius: "5px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "5px",
            }}
          >
            <FaClipboard /> Copier
          </button>
        </div>
      )}
      <video
        ref={videoRef}
        style={{
          position: "absolute",
          bottom: "10px",
          left: "10px",
          width: "200px",
          height: "150px",
          border: "2px solid #ff00ff",
          borderRadius: "5px",
          display: "none",
        }}
        autoPlay
      />
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
            onChange={(e) => handleFile(e, false)}
            style={{ display: "none" }}
          />
        </label>
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
          <FaImage /> Importer Image
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => handleFile(e, true)}
            style={{ display: "none" }}
          />
        </label>
        <button
          onClick={isStreaming ? stopVideoStream : startVideoStream}
          style={{
            padding: "8px 12px",
            backgroundColor: isStreaming ? "#ff3333" : "#00ff00",
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
          {isStreaming ? <FaStop /> : <FaVideo />}
          {isStreaming ? "Arrêter Vidéo" : "Lancer Vidéo"}
        </button>
        <button
          onClick={toggleVideoDisplay}
          style={{
            padding: "8px 12px",
            backgroundColor: showVideo ? "#ff3333" : "#00ccff",
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
          {showVideo ? <FaEyeSlash /> : <FaEye />}
          {showVideo ? "Masquer Vidéo" : "Afficher Vidéo"}
        </button>
        <button
          onClick={loadFromLocalStorage}
          style={{
            padding: "8px 12px",
            backgroundColor: "#00ccff",
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
          <FaDownload /> Charger depuis Local
        </button>
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
        <button
          onClick={() => setShowLogs(!showLogs)}
          style={{
            padding: "8px 12px",
            backgroundColor: showLogs ? "#ff3333" : "#00ccff",
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
          {showLogs ? <FaEyeSlash /> : <FaEye />}
          {showLogs ? "Masquer Logs" : "Afficher Logs"}
        </button>
      </div>
      <textarea
        ref={scriptRef}
        placeholder={`[
  {"type": "analyze_anomalies", "threshold": 0.05, "color": "#ff00ff"},
  {"type": "draw_lines", "color": "#00ff00", "thickness": 0.01},
  {"type": "topography", "color": "#ffff00"}
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
            video {
              width: 150px !important;
              height: 112px !important;
            }
            div[style*="bottom: 10px; right: 10px"] {
              width: 200px !important;
              max-height: 150px !important;
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
