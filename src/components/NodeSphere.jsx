import { useEffect, useMemo, useRef } from 'react';

// ============================================================================
// RECALL NODE SPHERE — FIBONACCI GRAPH & PERSPECTIVE PROJECTION
// Pure SVG, Zero External Dependencies, 30fps Capped, Accessible & MV3 Compliant
// ============================================================================

const NODE_COUNT = 28;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~2.399963229728653
const CAMERA_DIST = 3.2;
const CENTER_X = 140;
const CENTER_Y = 140;
const SPHERE_RADIUS = 92;
const PLATE_RADIUS = 138;
const CORE_RADIUS = 31; // ~34% of sphere radius

// Static yaw/pitch for reduced-motion / initial render
const STATIC_YAW = (25 * Math.PI) / 180;
const STATIC_PITCH = (-18 * Math.PI) / 180;

// 1. Fibonacci Sphere 3D Node Distribution
const NODES = (() => {
  const pts = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    const y = 1 - (i / (NODE_COUNT - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN_ANGLE * i;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    pts.push({ x, y, z, id: i });
  }
  return pts;
})();

// 2. Edges: Connect each node to its 3 nearest neighbours (deduplicated)
const EDGES = (() => {
  const edgeList = [];
  const edgeSet = new Set();
  for (let i = 0; i < NODE_COUNT; i++) {
    const distances = [];
    for (let j = 0; j < NODE_COUNT; j++) {
      if (i === j) continue;
      const dx = NODES[i].x - NODES[j].x;
      const dy = NODES[i].y - NODES[j].y;
      const dz = NODES[i].z - NODES[j].z;
      distances.push({ j, distSq: dx * dx + dy * dy + dz * dz });
    }
    distances.sort((a, b) => a.distSq - b.distSq);
    for (let k = 0; k < 3; k++) {
      const neighbor = distances[k].j;
      const a = Math.min(i, neighbor);
      const b = Math.max(i, neighbor);
      const key = `${a}-${b}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edgeList.push([a, b]);
      }
    }
  }
  return edgeList;
})();

// 3. Two Sculptural Great-Circle Rings
function createRing3D(tiltXDeg, tiltYDeg, segments = 36) {
  const pts = [];
  const radX = (tiltXDeg * Math.PI) / 180;
  const radY = (tiltYDeg * Math.PI) / 180;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    const z = 0;
    // Rotate around X
    const y1 = y * Math.cos(radX) - z * Math.sin(radX);
    const z1 = y * Math.sin(radX) + z * Math.cos(radX);
    // Rotate around Y
    const x2 = x * Math.cos(radY) + z1 * Math.sin(radY);
    const z2 = -x * Math.sin(radY) + z1 * Math.cos(radY);
    pts.push({ x: x2, y: y1, z: z2 });
  }
  return pts;
}

const RING_1 = createRing3D(28, 0, 36);
const RING_2 = createRing3D(-25, 35, 36);

// Transform a 3D point (x, y, z) by yaw & pitch, then perspective project
function projectPoint(pt, yaw, pitch) {
  // Yaw around Y
  const x1 = pt.x * Math.cos(yaw) + pt.z * Math.sin(yaw);
  const z1 = -pt.x * Math.sin(yaw) + pt.z * Math.cos(yaw);
  // Pitch around X
  const y2 = pt.y * Math.cos(pitch) - z1 * Math.sin(pitch);
  const z2 = pt.y * Math.sin(pitch) + z1 * Math.cos(pitch);
  const x2 = x1;

  const k = CAMERA_DIST / (CAMERA_DIST - z2);
  const px = CENTER_X + x2 * SPHERE_RADIUS * k;
  const py = CENTER_Y - y2 * SPHERE_RADIUS * k;

  // Depth cueing
  const opacity = z2 < 0 ? 0.25 + 0.1 * (z2 + 1) : 0.35 + 0.65 * z2;
  const radius = z2 < 0 ? 1.8 + 0.5 * (z2 + 1) : 2.4 + 1.8 * z2;

  return { px, py, z2, opacity, radius };
}

function computeRingPath(ringPts, yaw, pitch) {
  return ringPts.reduce((acc, pt, idx) => {
    const proj = projectPoint(pt, yaw, pitch);
    return `${acc}${idx === 0 ? 'M' : 'L'} ${proj.px.toFixed(1)} ${proj.py.toFixed(1)} `;
  }, '');
}

export default function NodeSphere({ selectedCount = 2, reduceMotion = false, heroRef = null }) {
  const edgeRefs = useRef([]);
  const nodeRefs = useRef([]);
  const ring1Ref = useRef(null);
  const ring2Ref = useRef(null);
  const containerRef = useRef(null);

  // Determine crimson accent node indices
  const crimsonNodeSet = useMemo(() => {
    const set = new Set();
    if (selectedCount >= 1) set.add(0);
    if (selectedCount >= 2) set.add(7);
    return set;
  }, [selectedCount]);

  // Compute initial static frame
  const initialFrame = useMemo(() => {
    const projectedNodes = NODES.map((pt) => projectPoint(pt, STATIC_YAW, STATIC_PITCH));
    const projectedEdges = EDGES.map(([i, j]) => {
      const p1 = projectedNodes[i];
      const p2 = projectedNodes[j];
      const avgOpacity = (p1.opacity + p2.opacity) * 0.5;
      return {
        x1: p1.px.toFixed(1),
        y1: p1.py.toFixed(1),
        x2: p2.px.toFixed(1),
        y2: p2.py.toFixed(1),
        opacity: avgOpacity.toFixed(2),
      };
    });
    const ring1Path = computeRingPath(RING_1, STATIC_YAW, STATIC_PITCH);
    const ring2Path = computeRingPath(RING_2, STATIC_YAW, STATIC_PITCH);

    return { projectedNodes, projectedEdges, ring1Path, ring2Path };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;

    let rafId = null;
    let isVisible = true;
    let isIntersecting = true;
    let lastTime = performance.now();
    let lastPointerTime = performance.now();

    let currentYaw = STATIC_YAW;
    let currentPitch = STATIC_PITCH;
    let targetYaw = STATIC_YAW;
    let targetPitch = STATIC_PITCH;

    // Pointer response: track cursor over hero container
    const heroEl = heroRef?.current || containerRef.current?.closest('.hero-block');
    const onPointerMove = (e) => {
      if (!heroEl) return;
      const rect = heroEl.getBoundingClientRect();
      const sphereCenterX = rect.left + rect.width * 0.5;
      const sphereCenterY = rect.top + rect.height * 0.45;

      const relX = (e.clientX - sphereCenterX) / (rect.width * 0.5);
      const relY = (e.clientY - sphereCenterY) / (rect.height * 0.5);

      const maxAngle = (35 * Math.PI) / 180;
      targetYaw = Math.max(-maxAngle, Math.min(maxAngle, relX * maxAngle));
      targetPitch = Math.max(-maxAngle, Math.min(maxAngle, -relY * maxAngle));
      lastPointerTime = performance.now();
    };

    if (heroEl) {
      heroEl.addEventListener('pointermove', onPointerMove, { passive: true });
    }

    // Visibility change
    const onVisibilityChange = () => {
      isVisible = !document.hidden;
      if (isVisible && isIntersecting && !rafId) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(renderLoop);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // IntersectionObserver to pause when offscreen
    let observer = null;
    if (window.IntersectionObserver && heroEl) {
      observer = new IntersectionObserver(([entry]) => {
        isIntersecting = entry.isIntersecting;
        if (isVisible && isIntersecting && !rafId) {
          lastTime = performance.now();
          rafId = requestAnimationFrame(renderLoop);
        }
      });
      observer.observe(heroEl);
    }

    // Direct DOM Mutation Animation Loop (capped at 30 fps)
    const renderLoop = (time) => {
      if (!isVisible || !isIntersecting) {
        rafId = null;
        return;
      }

      const elapsed = time - lastTime;
      if (elapsed < 33.3) {
        rafId = requestAnimationFrame(renderLoop);
        return;
      }

      const dt = Math.min(0.1, elapsed / 1000);
      lastTime = time;

      // Idle drift after 2s of no pointer movement
      if (time - lastPointerTime > 2000) {
        const driftSpeed = (4 * Math.PI) / 180; // 4 deg/sec
        targetYaw += driftSpeed * dt;
        currentYaw += driftSpeed * dt;
      } else {
        // Lerp toward pointer target
        currentYaw += (targetYaw - currentYaw) * 0.08;
        currentPitch += (targetPitch - currentPitch) * 0.08;
      }

      // Update projected nodes
      const projected = NODES.map((pt) => projectPoint(pt, currentYaw, currentPitch));

      // Mutate edge DOM attributes
      for (let eIdx = 0; eIdx < EDGES.length; eIdx++) {
        const edgeEl = edgeRefs.current[eIdx];
        if (!edgeEl) continue;
        const [i, j] = EDGES[eIdx];
        const p1 = projected[i];
        const p2 = projected[j];
        edgeEl.setAttribute('x1', p1.px.toFixed(1));
        edgeEl.setAttribute('y1', p1.py.toFixed(1));
        edgeEl.setAttribute('x2', p2.px.toFixed(1));
        edgeEl.setAttribute('y2', p2.py.toFixed(1));
        edgeEl.setAttribute('stroke-opacity', ((p1.opacity + p2.opacity) * 0.5).toFixed(2));
      }

      // Mutate node DOM attributes
      for (let nIdx = 0; nIdx < NODE_COUNT; nIdx++) {
        const nodeEl = nodeRefs.current[nIdx];
        if (!nodeEl) continue;
        const p = projected[nIdx];
        nodeEl.setAttribute('cx', p.px.toFixed(1));
        nodeEl.setAttribute('cy', p.py.toFixed(1));
        nodeEl.setAttribute('r', p.radius.toFixed(1));
        const isCrimson = crimsonNodeSet.has(nIdx);
        nodeEl.setAttribute('opacity', isCrimson ? '1' : p.opacity.toFixed(2));
      }

      // Mutate rings
      if (ring1Ref.current) {
        ring1Ref.current.setAttribute('d', computeRingPath(RING_1, currentYaw, currentPitch));
      }
      if (ring2Ref.current) {
        ring2Ref.current.setAttribute('d', computeRingPath(RING_2, currentYaw, currentPitch));
      }

      rafId = requestAnimationFrame(renderLoop);
    };

    rafId = requestAnimationFrame(renderLoop);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (heroEl) heroEl.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (observer) observer.disconnect();
    };
  }, [reduceMotion, heroRef, crimsonNodeSet]);

  return (
    <div className="node-sphere-plate" ref={containerRef} aria-hidden="true">
      <svg
        viewBox="0 0 280 280"
        className="node-sphere-svg"
        aria-hidden="true"
        focusable="false"
      >
        {/* Dark Circular Plate Background */}
        <circle
          cx={CENTER_X}
          cy={CENTER_Y}
          r={PLATE_RADIUS}
          fill="#0B0B0B"
          stroke="#2A2A2A"
          strokeWidth="1"
          className="node-sphere-base"
        />

        {/* Solid Crimson Core (behind wireframe lattice) */}
        <circle
          cx={CENTER_X}
          cy={CENTER_Y}
          r={CORE_RADIUS}
          fill="#C3203D"
          className="node-sphere-core"
        />

        {/* Great-Circle Rings */}
        <path
          ref={ring1Ref}
          d={initialFrame.ring1Path}
          fill="none"
          stroke="#F5F2EF"
          strokeWidth="1"
          strokeOpacity="0.22"
          strokeDasharray="3 4"
        />
        <path
          ref={ring2Ref}
          d={initialFrame.ring2Path}
          fill="none"
          stroke="#F5F2EF"
          strokeWidth="1"
          strokeOpacity="0.22"
        />

        {/* Wireframe Edges */}
        <g className="node-sphere-edges">
          {EDGES.map(([i, j], idx) => {
            const edge = initialFrame.projectedEdges[idx];
            return (
              <line
                key={`edge-${i}-${j}`}
                ref={(el) => (edgeRefs.current[idx] = el)}
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke="#F5F2EF"
                strokeWidth="1.2"
                strokeOpacity={edge.opacity}
              />
            );
          })}
        </g>

        {/* Nodes */}
        <g className="node-sphere-nodes">
          {NODES.map((_, idx) => {
            const node = initialFrame.projectedNodes[idx];
            const isCrimson = crimsonNodeSet.has(idx);
            return (
              <circle
                key={`node-${idx}`}
                ref={(el) => (nodeRefs.current[idx] = el)}
                cx={node.px.toFixed(1)}
                cy={node.py.toFixed(1)}
                r={node.radius.toFixed(1)}
                fill={isCrimson ? '#C3203D' : '#F5F2EF'}
                stroke={isCrimson ? '#FF5271' : '#141414'}
                strokeWidth={isCrimson ? '1.5' : '0.8'}
                opacity={isCrimson ? '1' : node.opacity.toFixed(2)}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
