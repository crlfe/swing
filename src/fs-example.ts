export function getExampleFiles() {
  return {
    "index.html": `<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="src/main.css">
</head>
<body>
    <h1>Welcome to Swing IDE</h1>
    <p>This is a real-time preview. Edit the files to see changes!</p>
    <div class="card">
        <p>The styling comes from <code>src/main.css</code></p>
        <button id="magic-btn">Click for Magic</button>
    </div>
    <script src="src/main.js"></script>
</body>
</html>`,

    "src/main.css": `body {
    font-family: system-ui, sans-serif;
    background: #f0f2f5;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    margin: 0;
}

.card {
    background: white;
    padding: 2rem;
    border-radius: 12px;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    text-align: center;
    max-width: 400px;
}

button {
    background: #007bff;
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 5px;
    cursor: pointer;
    font-weight: bold;
    transition: background 0.2s;
}

button:hover {
    background: #0056b3;
}`,

    "src/main.js": `document.getElementById("magic-btn").onclick = () => {
    const colors = ["#ffadad", "#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff", "#a0c4ff", "#bdb2ff", "#ffc6ff"];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    document.body.style.backgroundColor = randomColor;
    console.log("Magic color applied!");
};`,
  };
}
