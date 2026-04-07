import type { SVGProps } from "react";

const PiAgent = (props: SVGProps<SVGSVGElement>) => (
  <svg {...props} preserveAspectRatio="xMidYMid" viewBox="0 0 800 800">
    <path
      fill="#fff"
      fillRule="evenodd"
      d="
    M165.29 165.29
    H517.36
    V400
    H400
    V517.36
    H282.65
    V634.72
    H165.29
    Z
    M282.65 282.65
    V400
    H400
    V282.65
    Z
  "
    />
  </svg>
);

export { PiAgent };
