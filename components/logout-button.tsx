"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Icon } from "@iconify/react"
import { Button } from "@/components/ui/button"

export default function LogoutButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function logout() {
    setLoading(true)
    try {
      const res = await fetch("/api/auth", { method: "DELETE" })
      if (!res.ok) throw new Error("logout failed")
      router.push("/auth")
      router.refresh()
    } catch {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" onClick={logout} disabled={loading} className="gap-2">
      <Icon icon="mdi:logout" className="h-4 w-4" />
      {loading ? "退出中…" : "退出登录"}
    </Button>
  )
}
