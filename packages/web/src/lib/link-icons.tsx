import type { LucideIcon } from "lucide-react";
import {
  ExternalLink,
  Github,
  Globe,
  Linkedin,
  Mail,
  MessageCircle,
  Send,
} from "lucide-react";
import type { PublicPageLink } from "@/lib/public-page";

/** Simple X logo (lucide has no brand X). */
function XIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.259 5.686L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

type LinkIcon = LucideIcon | typeof XIcon;

/**
 * Pick an icon from link kind / label / URL (same mapping as LINK_KINDS).
 */
export function iconForPublicLink(link: PublicPageLink): LinkIcon {
  const hay = `${link.label} ${link.type} ${link.attrKey} ${link.href}`.toLowerCase();

  if (
    hay.includes("github") ||
    hay.includes("github.com")
  ) {
    return Github;
  }
  if (hay.includes("linkedin") || hay.includes("linkedin.com")) {
    return Linkedin;
  }
  if (
    hay.includes("telegram") ||
    hay.includes("t.me") ||
    hay.includes("telegram.me")
  ) {
    return Send;
  }
  if (
    /\bx\b/.test(hay) ||
    hay.includes("twitter") ||
    hay.includes("x.com")
  ) {
    return XIcon;
  }
  if (
    hay.includes("mail") ||
    hay.includes("mailto:") ||
    hay.includes("inbox") ||
    hay.includes("@")
  ) {
    return Mail;
  }
  if (
    hay.includes("website") ||
    hay.includes("web") ||
    link.type === "Website"
  ) {
    return Globe;
  }
  if (link.type === "LinkedDomains") {
    return MessageCircle;
  }
  return ExternalLink;
}
