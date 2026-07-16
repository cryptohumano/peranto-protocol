import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { BookmarkPlus, Check, Download, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactLinksSheet } from "@/components/ContactLinksSheet";
import { upsertAddressBookEntry } from "@/lib/address-book";
import { cn } from "@/lib/utils";
import type { PublicPageLink } from "@/lib/public-page";
import type { Address } from "viem";

type Props = {
  shareUrl: string;
  title: string;
  handle: string | null;
  did?: string;
  address: Address | null;
  links: PublicPageLink[];
  bio?: string;
  /** Larger QR for event / MyPage sheet */
  size?: "md" | "lg";
  className?: string;
  /** Ink/muted colors for themed public page */
  ink?: string;
  muted?: string;
  brand?: string;
  surface?: string;
};

function buildVCard(opts: {
  title: string;
  handle: string | null;
  did?: string;
  shareUrl: string;
  links: PublicPageLink[];
  bio?: string;
}): string {
  const fn = opts.title.replace(/[,;\\]/g, " ").slice(0, 64);
  const noteParts = [
    opts.handle ? `Peranto ${opts.handle}` : null,
    opts.did || null,
    opts.bio?.trim() || null,
    opts.links.length
      ? opts.links.map((l) => `${l.label}: ${l.href}`).join("\n")
      : null,
  ].filter(Boolean);
  const email = opts.links.find(
    (l) =>
      l.type === "CredentialInbox" ||
      /^mailto:/i.test(l.href) ||
      l.label.toLowerCase().includes("mail")
  );
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${fn}`,
    opts.handle ? `NICKNAME:${opts.handle.replace(/^@/, "")}` : null,
    `URL:${opts.shareUrl}`,
    email
      ? `EMAIL:${email.href.replace(/^mailto:/i, "")}`
      : null,
    noteParts.length
      ? `NOTE:${noteParts.join("\\n").replace(/\n/g, "\\n")}`
      : null,
    "END:VCARD",
  ].filter(Boolean);
  return lines.join("\r\n");
}

function toAddressBookLinks(links: PublicPageLink[]) {
  return links.map((l) => ({
    label: l.label,
    href: l.href,
    type: l.type,
    attrKey: l.attrKey,
  }));
}

/**
 * Presentation QR for linktr33 — scan opens the public page.
 * Scanner can save to the local address book or download a vCard.
 */
export function PublicPresentationCard({
  shareUrl,
  title,
  handle,
  did,
  address,
  links,
  bio,
  size = "md",
  className,
  ink,
  muted,
  brand,
  surface,
}: Props) {
  const [qr, setQr] = useState("");
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [savedHint, setSavedHint] = useState(false);

  const px = size === "lg" ? 280 : 168;

  useEffect(() => {
    if (!shareUrl) {
      setQr("");
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(shareUrl, {
      width: px,
      margin: 1,
      color: { dark: "#0f1f1a", light: "#ffffff" },
    }).then((url) => {
      if (!cancelled) setQr(url);
    });
    return () => {
      cancelled = true;
    };
  }, [shareUrl, px]);

  const who = handle ? (handle.startsWith("@") ? handle : `@${handle}`) : title;

  const note = useMemo(() => {
    const parts = [
      shareUrl,
      bio?.trim() || null,
      links
        .slice(0, 8)
        .map((l) => `${l.label}: ${l.href}`)
        .join(" · ") || null,
    ].filter(Boolean);
    return parts.join("\n").slice(0, 500);
  }, [shareUrl, bio, links]);

  const bookLinks = useMemo(() => toAddressBookLinks(links), [links]);

  function saveToBook() {
    if (!address) {
      setMsg("Esta página no tiene address on-chain para guardar");
      return;
    }
    upsertAddressBookEntry({
      address,
      label: who,
      note,
      source: "linktr33",
      shareUrl,
      links: bookLinks,
    });
    setSaved(true);
    setSavedHint(true);
    setContactOpen(true);
    setMsg("");
  }

  function openChannels() {
    setSavedHint(false);
    setContactOpen(true);
  }

  function downloadVCard() {
    const vcf = buildVCard({
      title: who,
      handle,
      did,
      shareUrl,
      links,
      bio,
    });
    const blob = new Blob([vcf], { type: "text/vcard;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(handle || title || "peranto").replace(/^@/, "")}.vcf`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg("vCard descargada — ábrela para añadir al teléfono");
  }

  return (
    <>
      <section
        className={cn(
          "mt-8 flex flex-col items-center gap-3 text-center",
          className
        )}
        style={{ color: ink }}
      >
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: brand || muted }}
        >
          Tarjeta de presentación
        </p>
        <div
          className={cn(
            "rounded-2xl p-3 shadow-lg shadow-black/10",
            size === "lg" ? "p-4" : "p-3"
          )}
          style={{ background: surface || "#fff" }}
        >
          {qr ? (
            <img
              src={qr}
              alt={`QR de presentación de ${who}`}
              width={px}
              height={px}
              className="rounded-lg"
            />
          ) : (
            <div
              className="flex items-center justify-center rounded-lg bg-black/5"
              style={{ width: px, height: px }}
            >
              <QrCode className="size-8 opacity-30" />
            </div>
          )}
        </div>
        <p className="max-w-xs text-xs" style={{ color: muted }}>
          Escanea para abrir este linktr33. Al guardar el contacto verás sus
          canales (Telegram, Mail, web…) para abrirlos en tu app.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!address}
            onClick={saveToBook}
          >
            {saved ? (
              <Check className="size-3.5" />
            ) : (
              <BookmarkPlus className="size-3.5" />
            )}
            {saved ? "En libreta" : "Guardar contacto"}
          </Button>
          {links.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={openChannels}
            >
              Ver canales
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={downloadVCard}>
            <Download className="size-3.5" />
            vCard
          </Button>
        </div>
        {msg && (
          <p className="text-[11px]" style={{ color: muted }}>
            {msg}
          </p>
        )}
      </section>

      <ContactLinksSheet
        open={contactOpen}
        onOpenChange={setContactOpen}
        label={title}
        handle={handle}
        shareUrl={shareUrl}
        links={bookLinks}
        savedHint={savedHint}
      />
    </>
  );
}
