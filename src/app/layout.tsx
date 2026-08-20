import "../../globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Designer’s Patio Hub",
  description: "Designer’s Patio sales, CRM, inventory and purchasing hub",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
