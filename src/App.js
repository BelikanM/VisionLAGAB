import React from "react";
import PointCloudEditor from "./PointCloudEditor";

function App() {
  return (
    <div style={{ textAlign: "center", padding: "40px", background: "#f7f7f7" }}>
      <h1>🌐 Application 3D - Nuage de Points</h1>
      <p>Téléversez un fichier .ply pour visualiser en 3D.</p>
      <PointCloudEditor />
    </div>
  );
}

export default App;
