export type DiffOp = "equal" | "insert" | "delete"

export interface DiffSegment {
  op: DiffOp
  text: string
}

/**
 * 基于 LCS 的词级差异。中英文混排时：英文按单词、中文按字切分，
 * 兼顾可读性与定位精度。返回的片段保留原始顺序，供前后两栏分别高亮。
 */
function tokenize(input: string): string[] {
  // 连续 ASCII 单词/数字作为一个 token；其余（含中文）逐字符
  const tokens: string[] = []
  const re = /[A-Za-z0-9]+|\s+|[^A-Za-z0-9\s]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) tokens.push(m[0])
  return tokens
}

export function diffWords(before: string, after: string): DiffSegment[] {
  const a = tokenize(before)
  const b = tokenize(after)
  const n = a.length
  const mLen = b.length

  // LCS 动态规划表
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(mLen + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = mLen - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const segs: DiffSegment[] = []
  const push = (op: DiffOp, text: string) => {
    const last = segs[segs.length - 1]
    if (last && last.op === op) last.text += text
    else segs.push({ op, text })
  }

  let i = 0
  let j = 0
  while (i < n && j < mLen) {
    if (a[i] === b[j]) {
      push("equal", a[i])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("delete", a[i])
      i++
    } else {
      push("insert", b[j])
      j++
    }
  }
  while (i < n) push("delete", a[i++])
  while (j < mLen) push("insert", b[j++])

  return segs
}
