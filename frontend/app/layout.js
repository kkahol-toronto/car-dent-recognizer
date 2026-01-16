import "./globals.css";

export const metadata = {
  title: "NeuroEYE Portal",
  description: "Damage and parts recognition portal",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
