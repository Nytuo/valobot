const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');

// Auto-register system font directories if present (e.g. Linux Alpine / Debian / Ubuntu)
['/usr/share/fonts', '/usr/local/share/fonts'].forEach(dir => {
  if (fs.existsSync(dir)) {
    try {
      GlobalFonts.loadFontsFromDir(dir);
    } catch (e) {
      // ignore
    }
  }
});

const FONT_STACK = '"DejaVu Sans", "Liberation Sans", "Noto Sans", Arial, sans-serif';

/**
 * Generates an authentic diagonal rubber stamp over the Valorant session card
 */
function renderSessionBanner(session, roster, isCancelled = false) {
  const width = 800;
  const height = 260;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const partySize = session.partySize || 5;
  const team1 = roster?.team1 || [];
  const spotsFilled = team1.length;
  const isLocked = session.status === 'locked';

  // 1. Dark Valorant Tactical Background
  const grad = ctx.createLinearGradient(0, 0, width, height);
  if (isCancelled) {
    grad.addColorStop(0, '#131114');
    grad.addColorStop(0.5, '#1e1418');
    grad.addColorStop(1, '#0e0b0d');
  } else {
    grad.addColorStop(0, '#0f1923');
    grad.addColorStop(0.5, '#172430');
    grad.addColorStop(1, '#0b1117');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // 2. Subtle grid pattern
  ctx.strokeStyle = isCancelled ? 'rgba(255, 70, 85, 0.08)' : 'rgba(255, 70, 85, 0.12)';
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

  // 3. Tactical Corner brackets
  ctx.strokeStyle = isCancelled ? '#57333d' : '#ff4655';
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

  // 4. Header Bar
  ctx.fillStyle = isCancelled ? '#7e3541' : '#ff4655';
  ctx.font = `bold 13px ${FONT_STACK}`;
  ctx.fillText('// PROTOCOL: VALORANT STACKING PROTOCOL', 30, 42);

  // Party Size Badge (e.g. 5-STACK, TRIO, DUO)
  const modeText = partySize === 2 ? 'DUO STACK' : partySize === 3 ? 'TRIO STACK' : '5-STACK';
  ctx.fillStyle = isCancelled ? '#352026' : '#233238';
  ctx.fillRect(width - 160, 24, 130, 28);
  ctx.strokeStyle = isCancelled ? '#7e3541' : '#00f59b';
  ctx.lineWidth = 1;
  ctx.strokeRect(width - 160, 24, 130, 28);

  ctx.fillStyle = isCancelled ? '#a0606b' : '#00f59b';
  ctx.font = `bold 13px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.fillText(modeText, width - 95, 43);
  ctx.textAlign = 'left';

  // 5. Title & Note
  ctx.fillStyle = isCancelled ? '#8a8585' : '#ece8e1';
  ctx.font = `900 32px ${FONT_STACK}`;
  const displayTitle = (session.note || 'VALORANT STACK').toUpperCase();
  ctx.fillText(displayTitle.length > 28 ? displayTitle.substring(0, 28) + '...' : displayTitle, 30, 90);

  // Time & Details
  ctx.fillStyle = '#8b978f';
  ctx.font = `600 15px ${FONT_STACK}`;
  ctx.fillText(`MATCH: ${session.partyTime} | DEADLINE: ${session.voteDeadline} | TARGET: ${session.targetRole?.name || '@everyone'}`, 30, 124);

  // 6. Slots Visualizer Bar
  const slotW = 54;
  const slotH = 46;
  const startX = 30;
  const startY = 150;

  for (let i = 0; i < partySize; i++) {
    const isOccupied = i < spotsFilled;
    const player = isOccupied ? team1[i] : null;

    ctx.fillStyle = isCancelled ? '#22191c' : (isOccupied ? '#1b3832' : '#141d24');
    ctx.strokeStyle = isCancelled ? '#442b32' : (isOccupied ? '#00f59b' : '#2c3e50');
    ctx.lineWidth = 2;

    ctx.fillRect(startX + i * (slotW + 12), startY, slotW, slotH);
    ctx.strokeRect(startX + i * (slotW + 12), startY, slotW, slotH);

    ctx.fillStyle = isOccupied ? (isCancelled ? '#7e4d58' : '#00f59b') : '#4f5d68';
    ctx.font = `bold 16px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.fillText(isOccupied ? `#${i + 1}` : 'OPEN', startX + i * (slotW + 12) + slotW / 2, startY + 28);
  }
  ctx.textAlign = 'left';

  // 7. Status Badge on right side
  const badgeX = width - 260;
  const badgeY = 150;
  ctx.fillStyle = isCancelled ? '#2b141a' : (isLocked ? '#2e2518' : '#142921');
  ctx.strokeStyle = isCancelled ? '#ff4655' : (isLocked ? '#f5a623' : '#00f59b');
  ctx.lineWidth = 2;
  ctx.fillRect(badgeX, badgeY, 230, slotH);
  ctx.strokeRect(badgeX, badgeY, 230, slotH);

  ctx.fillStyle = isCancelled ? '#ff4655' : (isLocked ? '#f5a623' : '#00f59b');
  ctx.font = `bold 15px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  const statusLabel = isCancelled ?
    'VOTE CANCELLED' :
    (isLocked ? 'VOTE LOCKED' : `${spotsFilled}/${partySize} SLOTS READY`);
  ctx.fillText(statusLabel, badgeX + 115, badgeY + 29);
  ctx.textAlign = 'left';

  // 8. DIAGONAL CANCELLED STAMP (If Cancelled)
  if (isCancelled) {
    ctx.save();
    // Center point for rotation
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-15 * Math.PI / 180); // Diagonal angle

    const stampW = 580;
    const stampH = 106;

    // Outer grunge/stamp border
    ctx.strokeStyle = 'rgba(255, 70, 85, 0.95)';
    ctx.lineWidth = 7;
    ctx.strokeRect(-stampW / 2, -stampH / 2, stampW, stampH);

    // Inner thin border
    ctx.strokeStyle = 'rgba(255, 70, 85, 0.55)';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(-stampW / 2 + 7, -stampH / 2 + 7, stampW - 14, stampH - 14);

    // Semi-transparent rubber tint wash
    ctx.fillStyle = 'rgba(255, 70, 85, 0.16)';
    ctx.fillRect(-stampW / 2, -stampH / 2, stampW, stampH);

    // Big Distressed Text: CANCELLED
    ctx.fillStyle = '#ff4655';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 56px ${FONT_STACK}`;
    ctx.fillText('CANCELLED', 0, -6);

    // Sub-banner
    ctx.font = `bold 14px ${FONT_STACK}`;
    ctx.fillStyle = 'rgba(255, 70, 85, 0.9)';
    ctx.fillText('• MISSION ABORTED • VOTE TERMINATED •', 0, 32);

    // Ink splatter / distress speckles around the stamp
    ctx.fillStyle = 'rgba(255, 70, 85, 0.35)';
    const speckles = [
      [-stampW / 2 - 10, -20, 3],
      [-stampW / 2 + 30, stampH / 2 + 8, 2],
      [stampW / 2 + 12, 10, 4],
      [stampW / 2 - 40, -stampH / 2 - 6, 2],
      [-120, stampH / 2 + 5, 2.5],
      [140, -stampH / 2 - 5, 3]
    ];
    for (const [sx, sy, sr] of speckles) {
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  return canvas.toBuffer('image/png');
}

module.exports = {
  renderSessionBanner
};
