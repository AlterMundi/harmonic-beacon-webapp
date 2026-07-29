import { redirect } from "next/navigation";

/**
 * `/login` was the Zitadel redirect. There is no separate attendee login page
 * now — the code + email form lives on the landing page — so this only keeps
 * old links, bookmarks and any stale client redirect from reaching a 404.
 */
export default function LoginPage() {
    redirect("/");
}
