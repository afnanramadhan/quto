/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0c10",
        fog: "#e6e6e6",
        mint: "#24d18f",
        ember: "#ff6b5a",
        ocean: "#1a5cff",
      },
      boxShadow: {
        soft: "0 10px 30px rgba(12, 12, 16, 0.18)",
      },
    },
  },
  plugins: [],
};
