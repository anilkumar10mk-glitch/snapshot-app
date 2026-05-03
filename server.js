const express = require("express");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const cron = require("node-cron");

const app = express();
const PORT = process.env.PORT || 8080;

// 📁 Google Drive Folder ID
const FOLDER_ID = "14R6Cj9zqDfbdEDK5YNWF6ul2TzhCpT3a";

// 🔐 OAuth using ENV variables
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// 🔐 Load token from ENV (IMPORTANT)
if (process.env.GOOGLE_TOKEN) {
  try {
    const token = JSON.parse(process.env.GOOGLE_TOKEN);
    oauth2Client.setCredentials(token);
    console.log("✅ Token loaded from ENV");
  } catch (err) {
    console.error("❌ Invalid GOOGLE_TOKEN format");
  }
} else {
  console.log("❌ GOOGLE_TOKEN missing");
}

const drive = google.drive({
  version: "v3",
  auth: oauth2Client,
});

// 🎯 COMMON FUNCTION
async function captureAndUpload(url) {
  const width = 650;
  const height = 750;
  const x = 20;
  const y = 450;
  const zoom = 2;
  const scale = 2.5;

  const now = new Date();
  const fileName = `${now.getHours()}-${now.getMinutes()}-${now.getDate()}-${now.getMonth() + 1}.png`;
  const filePath = path.join("/tmp", fileName); // IMPORTANT for Railway

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();

    await page.setViewport({
      width,
      height,
      deviceScaleFactor: scale,
    });

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 90000,
    });

    // Scroll
    await page.evaluate((scrollY) => {
      window.scrollBy(0, scrollY);
    }, y);

    // Zoom
    await page.evaluate((zoomLevel) => {
      document.body.style.zoom = zoomLevel;
    }, zoom);

    await new Promise((r) => setTimeout(r, 2000));

    await page.screenshot({
      path: filePath,
      clip: {
        x,
        y,
        width,
        height,
      },
    });

    await browser.close();

    // Upload to Drive
    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [FOLDER_ID],
      },
      media: {
        mimeType: "image/png",
        body: fs.createReadStream(filePath),
      },
      fields: "id",
    });

    // Make public
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    const fileUrl = `https://drive.google.com/uc?id=${response.data.id}`;

    fs.unlinkSync(filePath); // cleanup

    return fileUrl;

  } catch (error) {
    console.error("❌ ERROR:", error);
    if (browser) await browser.close();
    throw error;
  }
}

// 📸 Manual API
app.get("/capture", async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).send("Missing URL");
  }

  try {
    const fileUrl = await captureAndUpload(url);

    res.send({
      message: "Uploaded to Drive ✅",
      url: fileUrl,
    });

  } catch (error) {
    res.status(500).send("Error capturing/uploading ❌");
  }
});

// ⏱️ Scheduler config
const SCHEDULE_CONFIG = {
  url: "https://chartink.com/dashboard/105781",
  allowedDays: [0, 1, 2, 3, 4, 5], // Mon–Fri
  startHour: 9,
  endHour: 23,
};

// ⏱️ Run every 5 minutes
cron.schedule("*/5 * * * *", async () => {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();

  if (!SCHEDULE_CONFIG.allowedDays.includes(day)) {
    console.log("⏭ Skipped (day)");
    return;
  }

  if (hour < SCHEDULE_CONFIG.startHour || hour > SCHEDULE_CONFIG.endHour) {
    console.log("⏭ Skipped (time)");
    return;
  }

  console.log("📸 Running scheduled capture...");

  try {
    const url = await captureAndUpload(SCHEDULE_CONFIG.url);
    console.log("✅ Uploaded:", url);
  } catch (err) {
    console.error("❌ Scheduler error:", err.message);
  }
});

// ▶️ Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});