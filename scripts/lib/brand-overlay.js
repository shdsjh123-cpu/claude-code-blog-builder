import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';

import { chromium } from 'playwright';

function mimeFor(path) {
  const ext = extname(path).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/png';
}

async function dataUrl(path) {
  const abs = resolve(path);
  const buf = await readFile(abs);
  return `data:${mimeFor(abs)};base64,${buf.toString('base64')}`;
}

export async function applyBrandOverlay({
  imagePath,
  logoPath,
  brandName = '탐정법인 범랑',
  phone = '',
} = {}) {
  if (!imagePath || !logoPath || !existsSync(resolve(logoPath))) {
    return { applied: false, reason: 'missing logo' };
  }

  const imageUrl = await dataUrl(imagePath);
  const logoUrl = await dataUrl(logoPath);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    const pngBase64 = await page.evaluate(
      async ({ imageUrl, logoUrl, brandName, phone }) => {
        const loadImage = (src) =>
          new Promise((resolveImage, rejectImage) => {
            const img = new Image();
            img.onload = () => resolveImage(img);
            img.onerror = () => rejectImage(new Error('image load failed'));
            img.src = src;
          });

        const base = await loadImage(imageUrl);
        const logo = await loadImage(logoUrl);
        const canvas = document.createElement('canvas');
        canvas.width = base.naturalWidth || base.width;
        canvas.height = base.naturalHeight || base.height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(base, 0, 0, canvas.width, canvas.height);

        const pad = Math.round(Math.min(canvas.width, canvas.height) * 0.035);
        const maxLogoW = Math.round(canvas.width * 0.2);
        const maxLogoH = Math.round(canvas.height * 0.12);
        const scale = Math.min(maxLogoW / logo.width, maxLogoH / logo.height);
        const logoW = Math.max(80, Math.round(logo.width * scale));
        const logoH = Math.max(40, Math.round(logo.height * scale));
        const boxPad = Math.round(pad * 0.45);

        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.strokeStyle = 'rgba(20, 38, 74, 0.18)';
        ctx.lineWidth = Math.max(1, Math.round(canvas.width * 0.0015));
        ctx.beginPath();
        ctx.roundRect(
          pad - boxPad,
          pad - boxPad,
          logoW + boxPad * 2,
          logoH + boxPad * 2,
          Math.round(Math.min(logoW, logoH) * 0.12)
        );
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.drawImage(logo, pad, pad, logoW, logoH);

        if (brandName || phone) {
          const footerH = Math.round(canvas.height * 0.075);
          ctx.fillStyle = '#101b35';
          ctx.fillRect(0, canvas.height - footerH, canvas.width, footerH);
          ctx.fillStyle = '#ffffff';
          ctx.font = `700 ${Math.max(20, Math.round(footerH * 0.36))}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`;
          ctx.textBaseline = 'middle';
          ctx.fillText(brandName, pad, canvas.height - footerH / 2);
          if (phone) {
            ctx.textAlign = 'right';
            ctx.fillText(phone, canvas.width - pad, canvas.height - footerH / 2);
          }
        }

        return canvas.toDataURL('image/png').split(',')[1];
      },
      { imageUrl, logoUrl, brandName, phone }
    );

    await writeFile(imagePath, Buffer.from(pngBase64, 'base64'));
    return { applied: true, outputPath: imagePath };
  } finally {
    await browser.close();
  }
}
