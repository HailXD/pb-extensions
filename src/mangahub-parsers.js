/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */
/* Adapted from https://github.com/kittycatgit/kitty-extensions-0.8/tree/94f794a5399b55c77fa80965395ef0142acd8350/src/MangaHub */

function coverUrl(image) {
  const path = (image ?? "").trim();
  return path ? (/^https?:\/\//i.test(path) ? path : `${MH_COVER_CDN}/${path.replace(/^\/+/, "")}`) : `${MH_COVER_CDN}/no-cover.jpg`;
}

function listItem(row) {
  return App.createPartialSourceManga({
    mangaId: row.slug,
    title: row.title?.trim() || row.slug,
    image: coverUrl(row.image),
    ...(typeof row.latestChapter === "number" ? { subtitle: `Chapter ${row.latestChapter}` } : {})
  });
}

function genreId(name) {
  const known = MH_GENRES.find((genre) => genre.label.toLowerCase() === name.toLowerCase());
  return known?.id || name.toLowerCase().replace(/[^a-z0-9._\-@()[\]%?#+=/&:]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function parseApiManga(manga, mangaId) {
  const tags = (manga.genres ?? "").split(",").map((genre) => genre.trim()).filter(Boolean)
    .map((genre) => App.createTag({ id: genreId(genre), label: genre }));
  const titles = [manga.title?.trim() || mangaId];
  for (const part of (manga.alternativeTitle ?? "").split(";")) {
    const title = part.trim();
    if (title && !titles.includes(title)) titles.push(title);
  }
  const additionalInfo = {};
  if (typeof manga.latestChapter === "number") additionalInfo["Latest Chapter"] = String(manga.latestChapter);
  if (Array.isArray(manga.chapters)) additionalInfo.Chapters = String(manga.chapters.length);
  if (typeof manga.rank === "number") additionalInfo.Rank = `#${manga.rank}`;
  if (manga.isWebtoon) additionalInfo.Format = "Webtoon";
  if (manga.isLicensed) additionalInfo.Licensed = "Yes";
  if (manga.updatedDate) {
    const updated = new Date(manga.updatedDate);
    if (!Number.isNaN(updated.getTime())) additionalInfo.Updated = updated.toISOString().slice(0, 10);
  }
  const status = (manga.status ?? "").toLowerCase();
  const author = manga.author?.trim();
  const artist = manga.artist?.trim();
  return App.createSourceManga({
    id: mangaId,
    mangaInfo: App.createMangaInfo({
      titles,
      image: coverUrl(manga.image),
      desc: (manga.description ?? "").trim(),
      status: MH_STATUS_LABELS[status] ?? (status ? status.charAt(0).toUpperCase() + status.slice(1) : "Unknown"),
      hentai: Boolean(manga.isPorn || manga.isSoftPorn || manga.isYaoi),
      ...(author ? { author } : {}),
      ...(artist ? { artist } : {}),
      ...(tags.length ? { tags: [App.createTagSection({ id: "genres", label: "Genres", tags })] } : {}),
      ...(Object.keys(additionalInfo).length ? { additionalInfo } : {})
    })
  });
}

function parseApiChapters(rows) {
  const sorted = [...rows].sort((a, b) => b.number - a.number);
  return sorted.map((row, index) => {
    const published = row.date ? new Date(row.date) : undefined;
    const title = row.title?.trim();
    return App.createChapter({
      id: String(row.number),
      chapNum: row.number,
      langCode: CHAPTER_LANGUAGE,
      sortingIndex: sorted.length - index,
      name: title || `Chapter ${row.number}`,
      ...(published && !Number.isNaN(published.getTime()) ? { time: published } : {})
    });
  });
}

function parseApiPages(payload, keys) {
  const raw = typeof payload === "string" && payload.startsWith("enc:v1:") ? decryptEncV1(payload, keys) : payload;
  const pages = parseJson(raw);
  if (!pages || !Array.isArray(pages.i) || !pages.i.length ||
      pages.i.some((name) => typeof name !== "string" || !name.length)) {
    throw new Error("MangaHub returned an invalid chapter page list");
  }
  const prefix = typeof pages.p === "string" ? pages.p : "";
  return pages.i.map((name) => `${MH_CDN_DOMAIN}/${`${prefix}${name}`.replace(/^\/+/, "")}`);
}
