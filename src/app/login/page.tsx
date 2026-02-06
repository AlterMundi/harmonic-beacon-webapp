import { auth } from "@/auth";
import { redirect } from "next/navigation";
import LoginClient from "./LoginClient";

export default async function LoginPage() {
    const session = await auth();

    if (session?.user) {
        redirect("/live");
    }

    return <LoginClient />;
}
