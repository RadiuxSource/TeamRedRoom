"use client";

import { useState } from "react";

export function LogoMark() {
  const [imageError, setImageError] = useState(false);

  if (imageError) {
    return (
      <div className="logo-fallback" aria-label="Saint Hood Convent Tea and Confessions logo mark">
        SH
      </div>
    );
  }

  return (
    <img
      className="logo-image"
      src="/logo.jpg"
      alt="Saint Hood Convent Tea and Confessions logo"
      onError={() => setImageError(true)}
    />
  );
}