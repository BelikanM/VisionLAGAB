import React, { useRef, useState, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { FaFileUpload, FaPlay, FaRobot, FaSun, FaMoon, FaVideo, FaStop, FaDownload, FaEye, FaEyeSlash, FaClipboard, FaCloud, FaTrash, FaTimes } from "react-icons/fa";

function PointCloudViewer({ pointClouds, annotations, selectedCloudId }) {
  console.log("PointCloudViewer rendu", { pointClouds, annotations, selectedCloudId });
  return (
    <group>
      {pointClouds.map((cloud) => (
        <primitive
          key={cloud.id}
          object={cloud.points}
          dispose={null}
          visible={selectedCloudId === cloud.id}
        />
      ))}
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
  const [pointClouds, setPointClouds] = useState([]);
  const [selectedCloudId, setSelectedCloudId] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const [showStoredClouds, setShowStoredClouds] = useState(false);
  const [showPointCloudsPanel, setShowPointCloudsPanel] = useState(true); // Nouvel état pour le panneau "Nuages de Points"
  const [storedPointClouds, setStoredPointClouds] = useState([]);
  const inputRef = useRef();
  const imageInputRef = useRef();
  const videoRef = useRef();
  const scriptRef = useRef();
  const streamIntervalRef = useRef(null);
  const canvasRef = useRef();
  const MAX_CLOUDS = 10; // Limite de nuages dans localStorage

  const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`].slice(-50));
    console.log(`[${timestamp}] ${message}`);
  };

  const copyLogs = () => {
    navigator.clipboard.writeText(logs.join("\n"))
      .then(() => addLog("Logs copiés dans le presse-papiers"))
      .catch((err) => addLog(`Erreur lors de la copie des logs : ${err.message}`));
  };

  const hideMessages = () => {
    setErrorMessage(null);
    setIsLoading(false);
    addLog("Messages masqués manuellement");
  };

  async function fetchWithRetry(url, options, maxRetries = 3, timeout = 10000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: response.statusText }));
          throw new Error(`Erreur serveur : ${errorData.error || response.statusText}`);
        }
        return response;
      } catch (err) {
        addLog(`Échec de la requête (tentative ${attempt}/${maxRetries}) : ${err.message}`);
        if (attempt === maxRetries) throw err;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  async function handleFile(event, isImage = false) {
    const file = event.target.files[0];
    if (!file) {
      addLog("Aucun fichier sélectionné");
      setErrorMessage("Aucun fichier sélectionné");
      return;
    }

    setIsLoading(true);
    addLog(`Chargement du fichier : ${file.name}`);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const endpoint = isImage ? "http://localhost:5000/upload_image" : "http://localhost:5000/upload";
      const response = await fetchWithRetry(endpoint, {
        method: "POST",
        body: formData,
      });
      const cloudId = response.headers.get("X-Cloud-ID") || `cloud_${Date.now()}`;
      await handlePlyResponse(response, cloudId, file.name, isImage);
      setIsLoading(false);
    } catch (err) {
      const errorMsg = isImage 
        ? `Erreur lors du chargement de l'image : ${err.message}`
        : `Erreur lors du chargement du fichier PLY : ${err.message}. Vérifiez le format du fichier.`;
      setErrorMessage(errorMsg);
      addLog(errorMsg);
      setIsLoading(false);
    }
  }

  async function fetchAnnotationsWithRetry(maxRetries = 3, timeout = 10000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetchWithRetry(
          "http://localhost:5000/get_annotations",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
          maxRetries,
          timeout
        );
        const data = await response.json();
        if (data.error) {
          addLog(`Échec de la récupération des annotations (tentative ${attempt}) : ${data.error}`);
          if (attempt === maxRetries) {
            setErrorMessage(`Erreur lors de la récupération des annotations : ${data.error}`);
            return [];
          }
        } else {
          addLog(`Annotations reçues : ${data.annotations.length}`);
          return data.annotations || [];
        }
      } catch (err) {
        addLog(`Erreur réseau lors de la récupération des annotations (tentative ${attempt}) : ${err.message}`);
        if (attempt === maxRetries) {
          setErrorMessage(`Erreur lors de la récupération des annotations : ${err.message}`);
          return [];
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return [];
  }

  async function handlePlyResponse(response, cloudId, name, isImage = false) {
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
        updatePointCloud(data, cloudId, name, isImage);
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
            if (parts.length >= 3) {
              const x = parseFloat(parts[0]);
              const y = parseFloat(parts[1]);
              const z = parseFloat(parts[2]);
              if (isNaN(x) || isNaN(y) || isNaN(z)) {
                addLog(`Point invalide détecté : ${line}`);
                continue;
              }
              positions.push([x, y, z]);
              if (parts.length >= 6) {
                colors.push([parseInt(parts[3]) / 255, parseInt(parts[4]) / 255, parseInt(parts[5]) / 255]);
              }
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

        const annotations = await fetchAnnotationsWithRetry();
        updatePointCloud({
          positions,
          colors: colors.length === positions.length ? colors : null,
          annotations,
        }, cloudId, name, isImage);
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

  function updatePointCloud(data, cloudId, name, isImage = false) {
    if (!data.positions || data.positions.length === 0) {
      const errorMsg = "Aucun point valide reçu dans le nuage de points";
      setErrorMessage(errorMsg);
      addLog(errorMsg);
      return;
    }

    addLog(`Création du nuage de points avec ${data.positions.length} points, ID: ${cloudId}`);

    try {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(data.positions.flat());
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      addLog("Attribut de position défini");

      if (data.colors && data.colors.length === data.positions.length) {
        const colors = new Float32Array(data.colors.flat());
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        addLog("Couleurs appliquées au nuage de points");
      }

      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      addLog("Géométrie normalisée et boîte englobante calculée");

      const material = new THREE.PointsMaterial({
        size: 0.01,
        vertexColors: data.colors && data.colors.length === data.positions.length ? true : false,
        color: data.colors ? null : "#ffffff",
      });
      addLog("Matériau créé");

      const points = new THREE.Points(geometry, material);
      setPointClouds((prev) => {
        const updatedClouds = [...prev.filter(c => c.id !== cloudId), { id: cloudId, name: name || `Cloud ${prev.length + 1}`, points, data: { positions: data.positions, colors: data.colors, annotations: data.annotations || [] } }];
        try {
          localStorage.setItem("pointCloudData", JSON.stringify({
            pointClouds: updatedClouds.map(cloud => ({ id: cloud.id, name: cloud.name, data: cloud.data })),
          }));
          addLog("Données des nuages sauvegardées dans localStorage");
        } catch (err) {
          addLog(`Erreur localStorage (nuages) : ${err.message}`);
          setErrorMessage("Espace localStorage insuffisant pour les nuages de points");
        }
        return updatedClouds;
      });

      // Stocker automatiquement dans storedPointClouds si c'est une image
      if (isImage) {
        setStoredPointClouds((prev) => {
          const newCloud = { id: cloudId, name: name || `Cloud ${prev.length + 1}`, data: { positions: data.positions, colors: data.colors, annotations: data.annotations || [] } };
          const updatedClouds = [...prev, newCloud].slice(-MAX_CLOUDS);
          try {
            localStorage.setItem("storedPointClouds", JSON.stringify(updatedClouds));
            addLog(`Nuage stocké automatiquement : ${name}, total : ${updatedClouds.length}`);
          } catch (err) {
            addLog(`Erreur localStorage (nuages stockés) : ${err.message}`);
            setErrorMessage("Espace localStorage insuffisant pour les nuages stockés");
          }
          return updatedClouds;
        });
      }

      setSelectedCloudId(cloudId);
      setAnnotations(data.annotations || []);
      setErrorMessage(data.annotations.length === 0 ? "Aucune anomalie détectée." : null);
      addLog(`Nuage de points rendu, ID: ${cloudId}, annotations : ${data.annotations.length}`);
    } catch (err) {
      const errorMsg = `Erreur lors de la création du nuage de points : ${err.message}`;
      setErrorMessage(errorMsg);
      addLog(errorMsg);
    }
  }

  function savePointCloudToStorage(cloudId) {
    const cloud = pointClouds.find(c => c.id === cloudId);
    if (!cloud) {
      addLog(`Erreur : Nuage ${cloudId} non trouvé dans pointClouds`);
      setErrorMessage(`Nuage ${cloudId} non trouvé`);
      return;
    }

    setStoredPointClouds((prev) => {
      const newCloud = { id: cloud.id, name: cloud.name, data: { ...cloud.data } };
      // Éviter les doublons
      const updatedClouds = [...prev.filter(c => c.id !== cloudId), newCloud].slice(-MAX_CLOUDS);
      try {
        localStorage.setItem("storedPointClouds", JSON.stringify(updatedClouds));
        addLog(`Nuage enregistré manuellement : ${cloud.name}, total : ${updatedClouds.length}`);
      } catch (err) {
        addLog(`Erreur localStorage (enregistrement manuel) : ${err.message}`);
        setErrorMessage("Espace localStorage insuffisant pour enregistrer le nuage");
      }
      return updatedClouds;
    });
  }

  async function startVideoStream() {
    if (isStreaming) {
      addLog("Streaming déjà en cours");
      return;
    }
    try {
      addLog("Tentative d'accès à la caméra arrière");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 160, height: 120 },
      });
      videoRef.current.srcObject = stream;
      videoRef.current.style.display = showVideo ? "block" : "none";
      setIsStreaming(true);
      addLog("Caméra arrière ouverte");

      streamIntervalRef.current = setInterval(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = videoRef.current.videoWidth || 160;
        canvas.height = videoRef.current.videoHeight || 120;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(async (blob) => {
          setIsLoading(true);
          addLog("Envoi d'une frame vidéo au backend");
          const formData = new FormData();
          formData.append("file", blob, "frame.jpg");

          try {
            const response = await fetchWithRetry("http://localhost:5000/upload_image", {
              method: "POST",
              body: formData,
            });
            const cloudId = response.headers.get("X-Cloud-ID") || `cloud_${Date.now()}`;
            await handlePlyResponse(response, cloudId, `Frame ${cloudId.slice(0, 8)}`, true);
            setIsLoading(false);
          } catch (err) {
            const errorMsg = `Erreur lors du streaming : ${err.message}`;
            setErrorMessage(errorMsg);
            addLog(errorMsg);
            setIsLoading(false);
          }
        }, "image/jpeg");
      }, 2000);
    } catch (err) {
      const errorMsg = `Erreur lors de l'accès à la caméra arrière : ${err.message}. Vérifiez les permissions et la disponibilité de la caméra.`;
      setErrorMessage(errorMsg);
      addLog(errorMsg);
    }
  }

  function stopVideoStream() {
    if (!isStreaming) {
      addLog("Aucun streaming à arrêter");
      return;
    }
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
    if (!videoRef.current) {
      addLog("Aucune vidéo disponible pour afficher/masquer");
      return;
    }
    setShowVideo(!showVideo);
    videoRef.current.style.display = showVideo ? "none" : "block";
    addLog(`Fenêtre vidéo : ${showVideo ? "masquée" : "affichée"}`);
  }

  function loadFromLocalStorage() {
    addLog("Tentative de chargement depuis localStorage");
    const data = localStorage.getItem("pointCloudData");
    const storedClouds = localStorage.getItem("storedPointClouds");
    if (data) {
      try {
        const parsedData = JSON.parse(data);
        parsedData.pointClouds.forEach((cloud) => {
          updatePointCloud(cloud.data, cloud.id, cloud.name);
        });
        addLog(`Nuages récupérés depuis pointCloudData : ${parsedData.pointClouds.length}`);
      } catch (err) {
        const errorMsg = `Erreur lors du chargement depuis localStorage (nuages) : ${err.message}`;
        setErrorMessage(errorMsg);
        addLog(errorMsg);
      }
    }
    if (storedClouds) {
      try {
        const parsedClouds = JSON.parse(storedClouds).slice(-MAX_CLOUDS);
        setStoredPointClouds(parsedClouds);
        localStorage.setItem("storedPointClouds", JSON.stringify(parsedClouds));
        addLog(`Nuages stockés récupérés depuis localStorage : ${parsedClouds.length}`);
      } catch (err) {
        addLog(`Erreur lors du chargement des nuages stockés depuis localStorage : ${err.message}`);
      }
    }
  }

  async function handleScriptRun() {
    if (!scriptRef.current.value) {
      addLog("Aucun script JSON fourni");
      setErrorMessage("Veuillez entrer un script JSON valide");
      return;
    }
    try {
      addLog("Exécution du script JSON");
      const commands = JSON.parse(scriptRef.current.value);
      if (!Array.isArray(commands)) throw new Error("Script doit être un tableau JSON.");

      const selectedCloud = pointClouds.find(cloud => cloud.id === selectedCloudId);
      const response = await fetchWithRetry("http://localhost:5000/run_script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commands, positions: selectedCloud ? selectedCloud.data.positions : [] }),
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
    if (!scriptRef.current.value) {
      addLog("Aucun script JSON fourni pour l'inférence IA");
      setErrorMessage("Veuillez entrer un script JSON valide");
      return;
    }
    try {
      addLog("Lancement de l'inférence IA");
      const script = JSON.parse(scriptRef.current.value);
      if (!script.actions) throw new Error("Script invalide");

      const selectedCloud = pointClouds.find(cloud => cloud.id === selectedCloudId);
      const response = await fetchWithRetry("http://localhost:5000/run_inference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, positions: selectedCloud ? selectedCloud.data.positions : [] }),
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

  function toggleLogs() {
    setShowLogs(!showLogs);
    addLog(`Panneau des logs : ${showLogs ? "masqué" : "affiché"}`);
  }

  function toggleStoredClouds() {
    setShowStoredClouds(!showStoredClouds);
    addLog(`Panneau des nuages stockés : ${showStoredClouds ? "masqué" : "affiché"}`);
  }

  function togglePointCloudsPanel() {
    setShowPointCloudsPanel(!showPointCloudsPanel);
    addLog(`Panneau des nuages de points : ${showPointCloudsPanel ? "masqué" : "affiché"}`);
  }

  function deleteCloud(cloudId) {
    setPointClouds((prev) => {
      const updatedClouds = prev.filter(cloud => cloud.id !== cloudId);
      try {
        localStorage.setItem("pointCloudData", JSON.stringify({
          pointClouds: updatedClouds.map(cloud => ({ id: cloud.id, name: cloud.name, data: cloud.data })),
        }));
        addLog(`Nuage de points supprimé : ${cloudId}`);
      } catch (err) {
        addLog(`Erreur localStorage (suppression nuage) : ${err.message}`);
        setErrorMessage("Espace localStorage insuffisant pour mettre à jour les nuages");
      }
      return updatedClouds;
    });
    setStoredPointClouds((prev) => {
      const updatedStoredClouds = prev.filter(cloud => cloud.id !== cloudId);
      try {
        localStorage.setItem("storedPointClouds", JSON.stringify(updatedStoredClouds));
        addLog(`Nuage stocké supprimé : ${cloudId}`);
      } catch (err) {
        addLog(`Erreur localStorage (suppression nuage stocké) : ${err.message}`);
        setErrorMessage("Espace localStorage insuffisant pour mettre à jour les nuages stockés");
      }
      return updatedStoredClouds;
    });
    if (selectedCloudId === cloudId) {
      setSelectedCloudId(pointClouds.length > 1 ? pointClouds[0].id : null);
      setAnnotations([]);
    }
  }

  function selectStoredCloud(cloudId) {
    const cloud = storedPointClouds.find(c => c.id === cloudId);
    if (cloud) {
      updatePointCloud(cloud.data, cloud.id, cloud.name);
      addLog(`Nuage stocké chargé : ${cloud.name}`);
    } else {
      addLog(`Erreur : Nuage ${cloudId} non trouvé dans storedPointClouds`);
      setErrorMessage(`Nuage ${cloudId} non trouvé`);
    }
  }

  useEffect(() => {
    addLog("Composant PointCloudEditor monté");
    loadFromLocalStorage();
    return () => {
      stopVideoStream();
      addLog("Composant PointCloudEditor démonté");
    };
  }, []);

  useEffect(() => {
    if (errorMessage || isLoading) {
      const timer = setTimeout(() => {
        setErrorMessage(null);
        setIsLoading(false);
        addLog("Messages masqués automatiquement après 5 secondes");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage, isLoading]);

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
            top: "80px",
            left: "50%",
            transform: "translateX(-50%)",
            backgroundColor: "#ff3333",
            color: "#ffffff",
            padding: "10px",
            borderRadius: "5px",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          {errorMessage}
          <button
            onClick={hideMessages}
            style={{
              padding: "5px",
              backgroundColor: "#ffffff",
              color: "#ff3333",
              border: "none",
              borderRadius: "3px",
              cursor: "pointer",
            }}
          >
            <FaTimes />
          </button>
        </div>
      )}
      {isLoading && (
        <div
          style={{
            position: "absolute",
            top: "120px",
            left: "50%",
            transform: "translateX(-50%)",
            backgroundColor: "#00ccff",
            color: "#ffffff",
            padding: "10px",
            borderRadius: "5px",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          Traitement en cours...
          <button
            onClick={hideMessages}
            style={{
              padding: "5px",
              backgroundColor: "#ffffff",
              color: "#00ccff",
              border: "none",
              borderRadius: "3px",
              cursor: "pointer",
            }}
          >
            <FaTimes />
          </button>
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
      {showStoredClouds && (
        <div
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            width: "300px",
            maxHeight: "300px",
            backgroundColor: isDarkMode ? "#330066" : "#cc99ff",
            color: isDarkMode ? "#00ff00" : "#330066",
            border: "2px solid #ff00ff",
            borderRadius: "5px",
            padding: "10px",
            overflowY: "auto",
            zIndex: 1000,
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: "5px" }}>Nuages Stockés</div>
          {storedPointClouds.map((cloud) => (
            <div
              key={cloud.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "10px",
                cursor: "pointer",
                backgroundColor: selectedCloudId === cloud.id ? "#ff00ff" : "transparent",
              }}
              onClick={() => selectStoredCloud(cloud.id)}
            >
              <span>{cloud.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteCloud(cloud.id);
                }}
                style={{
                  padding: "5px",
                  backgroundColor: "#ff3333",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "3px",
                  cursor: "pointer",
                }}
              >
                <FaTrash />
              </button>
            </div>
          ))}
        </div>
      )}
      {showPointCloudsPanel && pointClouds.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "10px",
            left: "10px",
            width: "200px",
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
          <div style={{ fontWeight: "bold", marginBottom: "5px" }}>Nuages de Points</div>
          {pointClouds.map((cloud) => (
            <div
              key={cloud.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "5px",
                cursor: "pointer",
                backgroundColor: selectedCloudId === cloud.id ? "#ff00ff" : "transparent",
              }}
              onClick={() => {
                setSelectedCloudId(cloud.id);
                setAnnotations(cloud.data.annotations || []);
                addLog(`Nuage sélectionné : ${cloud.name}`);
              }}
            >
              <span>{cloud.name}</span>
              <div style={{ display: "flex", gap: "5px" }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    savePointCloudToStorage(cloud.id);
                  }}
                  style={{
                    padding: "2px 5px",
                    backgroundColor: "#00ccff",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "3px",
                    cursor: "pointer",
                  }}
                  title="Enregistrer dans le stockage"
                >
                  <FaCloud />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteCloud(cloud.id);
                  }}
                  style={{
                    padding: "2px 5px",
                    backgroundColor: "#ff3333",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "3px",
                    cursor: "pointer",
                  }}
                  title="Supprimer"
                >
                  <FaTrash />
                </button>
              </div>
            </div>
          ))}
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
          <FaCloud /> Importer Nuage (Image)
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => handleFile(e, true)}
            style={{ display: "none" }}
          />
        </label>
        <button
          onClick={startVideoStream}
          disabled={isStreaming}
          style={{
            padding: "8px 12px",
            backgroundColor: isStreaming ? "#cccccc" : "#00ff00",
            color: "#330066",
            border: "none",
            borderRadius: "5px",
            cursor: isStreaming ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "14px",
            minWidth: "120px",
          }}
        >
          <FaVideo /> Lancer Vidéo
        </button>
        <button
          onClick={stopVideoStream}
          disabled={!isStreaming}
          style={{
            padding: "8px 12px",
            backgroundColor: !isStreaming ? "#cccccc" : "#ff3333",
            color: "#330066",
            border: "none",
            borderRadius: "5px",
            cursor: !isStreaming ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "14px",
            minWidth: "120px",
          }}
        >
          <FaStop /> Arrêter Vidéo
        </button>
        <button
          onClick={toggleVideoDisplay}
          disabled={!isStreaming}
          style={{
            padding: "8px 12px",
            backgroundColor: !isStreaming ? "#cccccc" : showVideo ? "#ff3333" : "#00ccff",
            color: "#330066",
            border: "none",
            borderRadius: "5px",
            cursor: !isStreaming ? "not-allowed" : "pointer",
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
          onClick={toggleLogs}
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
        <button
          onClick={toggleStoredClouds}
          style={{
            padding: "8px 12px",
            backgroundColor: showStoredClouds ? "#ff3333" : "#00ccff",
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
          {showStoredClouds ? <FaEyeSlash /> : <FaCloud />}
          {showStoredClouds ? "Masquer Nuages" : "Afficher Nuages Stockés"}
        </button>
        <button
          onClick={togglePointCloudsPanel}
          style={{
            padding: "8px 12px",
            backgroundColor: showPointCloudsPanel ? "#ff3333" : "#00ccff",
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
          {showPointCloudsPanel ? <FaEyeSlash /> : <FaEye />}
          {showPointCloudsPanel ? "Masquer Nuages de Points" : "Afficher Nuages de Points"}
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
            div[style*="bottom: 10px; right: 10px"], div[style*="top: 10px; right: 10px"], div[style*="top: 10px; left: 10px"] {
              width: 200px !important;
              max-height: 150px !important;
            }
            div[style*="top: 80px"], div[style*="top: 120px"] {
              width: 80% !important;
              font-size: 12px !important;
            }
          }
        `}
      </style>
      <Canvas
        ref={canvasRef}
        style={{ width: "100%", height: "calc(100% - 150px)" }}
        camera={{ position: [0, 0, 1], fov: 75 }}
      >
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />
        {pointClouds.length > 0 && (
          <PointCloudViewer pointClouds={pointClouds} annotations={annotations} selectedCloudId={selectedCloudId} />
        )}
        <OrbitControls />
      </Canvas>
    </div>
  );
}

export default PointCloudEditor;
