import React, { useRef, useEffect } from 'react';

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export default function GeoMap({ userLocation, activeZone, allZones = [] }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas || !activeZone) return;
      const ctx = canvas.getContext('2d');
      const W = canvas.width = canvas.offsetWidth || 600;
      const H = canvas.height = 300;
      ctx.clearRect(0, 0, W, H);

      const cx = W / 2, cy = H / 2;
      const scale = Math.min(W, H) / (activeZone.radius * 5.5);

      // Grid
      ctx.strokeStyle = 'rgba(91,156,246,0.05)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 36) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
      for (let y = 0; y < H; y += 36) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

      // Other zones
      allZones.filter(z => z.id !== activeZone.id).forEach(z => {
        const dx = (z.lng - activeZone.lng) * 111000 * scale;
        const dy = -(z.lat - activeZone.lat) * 111000 * scale;
        const r = z.radius * scale;
        if (Math.abs(dx) > W || Math.abs(dy) > H) return;
        ctx.beginPath(); ctx.arc(cx+dx, cy+dy, r, 0, Math.PI*2);
        ctx.strokeStyle = 'rgba(91,156,246,0.12)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = 'rgba(91,156,246,0.03)'; ctx.fill();
      });

      // Active zone glow rings
      const inside = userLocation && haversine(userLocation.lat, userLocation.lng, activeZone.lat, activeZone.lng) <= activeZone.radius;
      const glowColor = inside ? '52,211,153' : '91,156,246';
      for (let i = 3; i >= 1; i--) {
        ctx.beginPath(); ctx.arc(cx, cy, activeZone.radius * scale * (0.4 + i*0.15), 0, Math.PI*2);
        ctx.strokeStyle = `rgba(${glowColor},${0.04+i*0.03})`; ctx.lineWidth = 1; ctx.stroke();
      }

      // Zone fill
      ctx.beginPath(); ctx.arc(cx, cy, activeZone.radius * scale, 0, Math.PI*2);
      ctx.fillStyle = inside ? 'rgba(52,211,153,0.05)' : 'rgba(91,156,246,0.04)'; ctx.fill();

      // Zone boundary solid
      ctx.beginPath(); ctx.arc(cx, cy, activeZone.radius * scale, 0, Math.PI*2);
      ctx.strokeStyle = inside ? 'rgba(52,211,153,0.6)' : 'rgba(91,156,246,0.45)';
      ctx.lineWidth = 2; ctx.stroke();

      // Zone boundary dashed
      ctx.save(); ctx.setLineDash([6,6]);
      ctx.beginPath(); ctx.arc(cx, cy, activeZone.radius * scale, 0, Math.PI*2);
      ctx.strokeStyle = inside ? 'rgba(52,211,153,0.2)' : 'rgba(91,156,246,0.15)';
      ctx.lineWidth = 1; ctx.stroke(); ctx.restore();

      // Zone center
      ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(91,156,246,0.15)'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI*2);
      ctx.fillStyle = '#5b9cf6'; ctx.fill();
      ctx.fillStyle = 'rgba(91,156,246,0.7)';
      ctx.font = '500 11px "DM Mono"'; ctx.textAlign = 'center';
      ctx.fillText(activeZone.name, cx, cy - activeZone.radius * scale - 14);

      // User dot
      if (userLocation) {
        const ux = cx + (userLocation.lng - activeZone.lng) * 111000 * scale;
        const uy = cy - (userLocation.lat - activeZone.lat) * 111000 * scale;

        // Accuracy
        if (userLocation.accuracy) {
          ctx.beginPath(); ctx.arc(ux, uy, userLocation.accuracy * scale, 0, Math.PI*2);
          ctx.fillStyle = inside ? 'rgba(52,211,153,0.06)' : 'rgba(251,191,36,0.06)'; ctx.fill();
        }

        // Pulse
        const t = Date.now() / 500;
        const p = 0.5 + 0.5 * Math.sin(t);
        ctx.beginPath(); ctx.arc(ux, uy, 18 + p*8, 0, Math.PI*2);
        ctx.strokeStyle = inside ? `rgba(52,211,153,${0.15+p*0.2})` : `rgba(251,191,36,${0.15+p*0.2})`;
        ctx.lineWidth = 2; ctx.stroke();

        ctx.beginPath(); ctx.arc(ux, uy, 11, 0, Math.PI*2);
        ctx.fillStyle = inside ? 'rgba(52,211,153,0.2)' : 'rgba(251,191,36,0.2)'; ctx.fill();
        ctx.beginPath(); ctx.arc(ux, uy, 6, 0, Math.PI*2);
        ctx.fillStyle = inside ? '#34d399' : '#fbbf24'; ctx.fill();

        // Line to center
        ctx.save(); ctx.setLineDash([4,4]);
        ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(ux,uy);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();

        // Distance
        const dist = Math.round(haversine(userLocation.lat, userLocation.lng, activeZone.lat, activeZone.lng));
        const mx = (cx+ux)/2, my = (cy+uy)/2;
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '500 10px "DM Mono"'; ctx.textAlign = 'center';
        ctx.fillText(`${dist}m`, mx, my-5);
      }

      // Compass rose
      ctx.save(); ctx.translate(W-34, 34);
      ctx.fillStyle = 'rgba(8,12,24,0.8)'; ctx.beginPath(); ctx.arc(0,0,18,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = 'rgba(91,156,246,0.3)'; ctx.lineWidth = 0.5; ctx.stroke();
      ctx.textAlign = 'center'; ctx.font = '700 9px sans-serif';
      ctx.fillStyle = '#f87171'; ctx.fillText('N', 0, -6);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillText('S', 0, 11);
      ctx.restore();

      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [userLocation, activeZone, allZones]);

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 300 }} />;
}
