const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');

function renderStampImage(title = 'VALORANT 5-STACK', partyTime = '21:00', isCancelled = true) {
  const width = 800;
  const height = 260;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background - Valorant dark aesthetic
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#0f1923');
  grad.addColorStop(0.5, '#172430');
  grad.addColorStop(1, '#0b1117');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Geometric grid lines & Valorant accents
  ctx.strokeStyle = 'rgba(255, 70, 85, 0.15)';
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Tactical corner brackets
  ctx.strokeStyle = '#ff4655';
  ctx.lineWidth = 3;
  // Top-left
  ctx.beginPath();
  ctx.moveTo(15, 35);
  ctx.lineTo(15, 15);
  ctx.lineTo(35, 15);
  ctx.stroke();
  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(width - 35, height - 15);
  ctx.lineTo(width - 15, height - 15);
  ctx.lineTo(width - 15, height - 35);
  ctx.stroke();

  // Top header text
  ctx.fillStyle = '#ff4655';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('// PROTOCOL: RECRUITMENT SESSION', 30, 45);

  ctx.fillStyle = '#ece8e1';
  ctx.font = '900 36px sans-serif';
  ctx.fillText(title.toUpperCase(), 30, 95);

  ctx.fillStyle = '#8b978f';
  ctx.font = '600 16px sans-serif';
  ctx.fillText(`START TIME: ${partyTime} UTC+1 | TARGET STACK: 5 PLAYERS`, 30, 130);

  // Status indicator box
  ctx.fillStyle = isCancelled ? '#2b1b22' : '#143029';
  ctx.strokeStyle = isCancelled ? '#ff4655' : '#00f59b';
  ctx.lineWidth = 2;
  ctx.strokeRect(30, 160, 240, 50);
  ctx.fillRect(30, 160, 240, 50);

  ctx.fillStyle = isCancelled ? '#ff4655' : '#00f59b';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(isCancelled ? 'STATUS: CANCELLED' : 'STATUS: RECRUITING', 45, 192);

  if (isCancelled) {
    // DRAW MASSIVE DIAGONAL RUBBER STAMP
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-15 * Math.PI / 180); // Diagonal angle

    // Stamp outer box
    const stampW = 540;
    const stampH = 100;
    ctx.strokeStyle = 'rgba(255, 70, 85, 0.9)';
    ctx.lineWidth = 8;
    ctx.strokeRect(-stampW / 2, -stampH / 2, stampW, stampH);

    // Stamp inner thin border
    ctx.strokeStyle = 'rgba(255, 70, 85, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(-stampW / 2 + 6, -stampH / 2 + 6, stampW - 12, stampH - 12);

    // Background semi-transparent wash for stamp
    ctx.fillStyle = 'rgba(255, 70, 85, 0.12)';
    ctx.fillRect(-stampW / 2, -stampH / 2, stampW, stampH);

    // Stamped Text
    ctx.fillStyle = '#ff4655';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 52px sans-serif';
    ctx.fillText('CANCELLED', 0, -6);

    ctx.font = 'bold 14px sans-serif';
    ctx.letterSpacing = '6px';
    ctx.fillText('• MISSION ABORTED BY SENDER •', 0, 30);

    ctx.restore();
  }

  return canvas.toBuffer('image/png');
}

fs.writeFileSync('public/assets/test_stamp.png', renderStampImage('VALORANT 5-STACK', '21:00', true));
console.log('Stamp generated at public/assets/test_stamp.png');
