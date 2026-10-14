/**
 * Theme preference keys and the inline script that puts the theme on <html>
 * while the HTML is parsed, before the first paint (Next.js guide "Preventing
 * flash before hydration"). Plain module: the server layout needs the string.
 */
export const THEME_KEY = "tms-theme";
export const MAP_STYLE_KEY = "tms-map-style";

export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_KEY}");var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})()`;
