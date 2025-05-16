const express = require("express");
const axios = require("axios");
const fs = require("fs");
const { execSync } = require("child_process");
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const app = express();
const port = process.env.PORT || 10000;

app.use(express.json());

// AWS S3 config
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

// Route GET pour vérifier que le serveur est en ligne
app.get("/", (req, res) => {
  res.send("✅ FFmpeg API is live!");
});

// Route POST pour extraire des images d'une vidéo
app.post("/extract", async (req, res) => {
  const { video_url } = req.body;

  if (!video_url) {
    return res.status(400).json({ error: "video_url manquant" });
  }

  // Vérifier l'extension
  const ext = video_url.split(".").pop().toLowerCase();
  if (!["mp4", "webm", "mov"].includes(ext)) {
    return res.status(400).json({ error: "Format vidéo non supporté" });
  }

  try {
    const videoTempPath = `/tmp/input-${uuidv4()}.${ext}`;

    // 1. Télécharger la vidéo depuis S3
    const response = await axios({
      method: "GET",
      url: video_url,
      responseType: "stream",
    });

    const writer = fs.createWriteStream(videoTempPath);
    await new Promise((resolve, reject) => {
      response.data.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    // 2. Découper la vidéo avec FFmpeg (1 image toutes les 5 secondes, en partant de )
    const framePattern = `/tmp/frame-%03d.jpg`;
    execSync(`ffmpeg -ss 2 -i ${videoTempPath} -vf fps=1/5 ${framePattern}`);

    // 3. Lire les images générées
    const frames = fs
      .readdirSync("/tmp")
      .filter((f) => f.startsWith("frame-") && f.endsWith(".jpg"));

    const urls = [];

    for (const filename of frames) {
      const buffer = fs.readFileSync(`/tmp/${filename}`);
      const s3Key = `frames/${uuidv4()}.jpg`;

      await s3
        .putObject({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: s3Key,
          Body: buffer,
          ContentType: "image/jpeg",
        })
        .promise();

      urls.push(`https://${process.env.AWS_BUCKET_NAME}.s3.amazonaws.com/${s3Key}`);
    }

    res.json({ frames: urls });
  } catch (err) {
    console.error("Erreur traitement FFmpeg :", err);
    res.status(500).json({ error: "Erreur lors du traitement vidéo." });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
