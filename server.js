const express = require("express");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const cron = require("node-cron");

const app = express();
const PORT = process.env.PORT || 8080;

// ✅ Health check (IMPORTANT for Railway)
app.get("/", (req, res) => {
  res.send("Server is running ✅");
});

// 📁 Google Drive Folder ID
const FOLDER_ID = "14R6Cj9zqDfbdEDK5YNWF6ul2TzhCpT3a";

// 🔐 OAuth setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// 🔐 Load token from ENV
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
  const width = 650;      // optimized
  const height = 750;     // optimized
  const x = 20;
  const y = 450;
  const zoom = 2;
  const scale = 2.5;      // reduced memory usage

const now = new Date();

// Convert to IST
const istTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

const fileName = `${istTime.getHours()}-${istTime.getMinutes()}-${istTime.getDate()}-${istTime.getMonth() + 1}.png`;

    const filePath = path.join("/tmp", fileName);

  let browser;

  try {
    console.log("🌐 Launching browser...");

browser = await puppeteer.launch({
  headless: "new",
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--single-process",
    "--no-zygote",
  ],
});

    const page = await browser.newPage();

    await page.setViewport({
      width,
      height,
      deviceScaleFactor: scale,
    });

    console.log("🌍 Opening URL:", url);

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 60000, // reduced timeout
    });

    // Scroll
    await page.evaluate((scrollY) => {
      window.scrollBy(0, scrollY);
    }, y);

    // Zoom
    await page.evaluate((zoomLevel) => {
      document.body.style.zoom = zoomLevel;
    }, zoom);

    await new Promise((r) => setTimeout(r, 1500)); // reduced wait

    console.log("📸 Taking screenshot...");

    await page.screenshot({
      path: filePath,
      clip: {
        x,
        y,
        width,
        height,
      },
    });

    console.log("☁️ Uploading to Drive...");

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

    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    const fileUrl = `https://drive.google.com/uc?id=${response.data.id}`;

    fs.unlinkSync(filePath);

    console.log("✅ Upload complete:", fileUrl);

    return fileUrl;

  } catch (error) {
    console.error("❌ ERROR:", error.message);
    throw error;
  } finally {
    if (browser) {
      try {
        await browser.close();   // 🔥 ALWAYS CLOSE
      } catch (e) {
        console.log("⚠️ Browser close error ignored");
      }
    }
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
  allowedDays: [1, 2, 3, 4, 5], // Sun–Fri
  startHour: 4,
  endHour: 10,
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