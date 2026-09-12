import { useId, type SVGProps } from "react";
import geometry from "../assets/brand-icon.json";

function bottomRoundedRectPath({ x, y, width, height, bottomRadius }: typeof geometry.pageCutout) {
  const right = x + width;
  const bottom = y + height;
  return `M${x} ${y}H${right}V${bottom - bottomRadius}A${bottomRadius} ${bottomRadius} 0 0 1 ${right - bottomRadius} ${bottom}H${x + bottomRadius}A${bottomRadius} ${bottomRadius} 0 0 1 ${x} ${bottom - bottomRadius}Z`;
}

export default function BrandMark(props: SVGProps<SVGSVGElement>) {
  const maskId = `brand-glyph-${useId().replaceAll(":", "")}`;

  return (
    <svg viewBox={`0 0 ${geometry.canvasSize} ${geometry.canvasSize}`} fill="none" aria-hidden="true" {...props}>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={geometry.canvasSize} height={geometry.canvasSize}>
          <rect x={geometry.shell.x} y={geometry.shell.y} width={geometry.shell.width} height={geometry.shell.height} rx={geometry.shell.radius} fill="white" />
          <path d={bottomRoundedRectPath(geometry.pageCutout)} fill="black" />
          {geometry.notches.map((notch) => <rect key={`${notch.x}-${notch.y}`} x={notch.x} y={notch.y} width={notch.width} height={notch.height} rx={notch.radius} fill="black" />)}
          {geometry.binders.map((binder) => <rect key={`${binder.x}-${binder.y}`} x={binder.x} y={binder.y} width={binder.width} height={binder.height} rx={binder.radius} fill="white" />)}
          <circle cx={geometry.clock.cx} cy={geometry.clock.cy} r={geometry.clock.outerRadius} fill="white" />
          <circle cx={geometry.clock.cx} cy={geometry.clock.cy} r={geometry.clock.innerRadius} fill="black" />
          {geometry.hands.map((hand) => <rect key={`${hand.x}-${hand.y}`} x={hand.x} y={hand.y} width={hand.width} height={hand.height} rx={hand.radius} fill="white" />)}
        </mask>
      </defs>
      <rect x="6.4" y="6.4" width="499.2" height="499.2" rx="134.4" fill="var(--accent)" />
      <g transform="translate(76.8 76.8) scale(.7)">
        <rect width={geometry.canvasSize} height={geometry.canvasSize} fill="var(--accent-contrast)" mask={`url(#${maskId})`} />
      </g>
    </svg>
  );
}
