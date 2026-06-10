// Copyright (c) 2025 wzdnzd
// SPDX-License-Identifier: MIT
/* eslint-disable @next/next/no-img-element */
"use client"

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { Icon } from "@iconify/react"
import type { ResumeData } from "@/types/resume"
import type { WorkspaceSelection } from "@/lib/agent/types"
import { docToText } from "@/lib/agent/changeset"
import { normalizeResumeTargetId, sortedByColumn, sortedByOrder } from "@/lib/resume-core"
import RichTextRenderer from "./rich-text-renderer"

interface ResumePreviewProps {
  resumeData: ResumeData
  /** 开启后预览中的元素可点选，用于限定 Agent 上下文 */
  interactive?: boolean
  selectedId?: string | null
  highlightedIds?: string[]
  onSelect?: (selection: WorkspaceSelection | null) => void
  /** 点击元素旁「用 AI 优化」时触发 */
  onRequestAI?: (selection: WorkspaceSelection) => void
}

/**
 * 简历预览组件
 */
export default function ResumePreview({
  resumeData,
  interactive = false,
  selectedId = null,
  highlightedIds = [],
  onSelect,
}: ResumePreviewProps) {
  const isAsciiOnly = (str: string | undefined) => !!str && /^[\x00-\x7F]+$/.test(str);

  const highlightSet = useMemo(
    () => new Set(highlightedIds.map(normalizeResumeTargetId).filter(Boolean)),
    [highlightedIds],
  )

  // 选择/高亮辅助
  const selClass = (id: string) => {
    const hi = highlightSet.has(normalizeResumeTargetId(id)) ? "rp-highlight" : "";
    if (!interactive) return hi;
    const sel = selectedId === id ? "rp-selected" : "";
    return `rp-selectable ${sel} ${hi}`.trim();
  };
  const pick = (e: React.MouseEvent, selection: WorkspaceSelection) => {
    if (!interactive) return;
    e.stopPropagation();
    onSelect?.(selectedId === selection.id ? null : selection);
  };
  const SelectionBubble = ({ selection }: { selection: WorkspaceSelection }) => {
    if (!interactive || selectedId !== selection.id) return null
    return (
      <div
        className="rp-selection-bubble no-print"
        role="status"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rp-selection-bubble-label">
          <Icon icon="mdi:cursor-default-click" className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{selection.label}</span>
        </div>
      </div>
    )
  }

  const themeColor = resumeData.themeColor;
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const personalGridRef = useRef<HTMLDivElement | null>(null);
  const jobIntentionWrapRef = useRef<HTMLDivElement | null>(null);
  const jobIntentionBadgeRef = useRef<HTMLSpanElement | null>(null);
  const jobIntentionTextRef = useRef<HTMLSpanElement | null>(null);
  const [rightBoxHeight, setRightBoxHeight] = useState<number | undefined>(undefined);
  const [stretchRowGapPx, setStretchRowGapPx] = useState<number | undefined>(undefined);
  const [idPhotoHeight, setIdPhotoHeight] = useState<number | undefined>(undefined);
  const [jobIntentionScale, setJobIntentionScale] = useState<number>(1);
  const [jobIntentionFontScale, setJobIntentionFontScale] = useState<number>(1);

  const orderedJobIntentionItems = useMemo(
    () => sortedByOrder(resumeData.jobIntentionSection?.items || []),
    [resumeData.jobIntentionSection?.items],
  );
  const personalInfo = useMemo(
    () => sortedByOrder(resumeData.personalInfoSection?.personalInfo || []),
    [resumeData.personalInfoSection?.personalInfo],
  );
  const orderedModules = useMemo(
    () =>
      sortedByOrder(resumeData.modules).map((module) => ({
        ...module,
        rows: sortedByOrder(module.rows).map((row) => ({
          ...row,
          elements: sortedByColumn(row.elements),
        })),
      })),
    [resumeData.modules],
  );

  // 等高策略：测量左侧真实高度，设置右侧容器高度；
  // 父容器使用 items-start，避免 items-stretch 与右侧固定高度形成“锁高”导致头像不随左侧收缩。
  const jobIntentionText = useMemo(() => {
    if (!resumeData.jobIntentionSection?.enabled || !resumeData.jobIntentionSection?.items?.length) {
      return null;
    }

    const items = orderedJobIntentionItems
      .filter(item => {
        // 过滤掉空值的项
        if (item.type === 'salary') {
          return item.salaryRange?.min !== undefined || item.salaryRange?.max !== undefined;
        }
        return item.value && item.value.trim() !== '';
      })
      .map(item => `${item.label}：${item.value}`)
      .join(' ｜ ');

    return items || null;
  }, [
    orderedJobIntentionItems,
    resumeData.jobIntentionSection?.enabled,
    resumeData.jobIntentionSection?.items?.length,
  ]);

  const avatarType = resumeData.personalInfoSection?.avatarType === "idPhoto" ? "idPhoto" : "default";
  const isIdPhoto = avatarType === "idPhoto";
  const hasIdPhotoHeader = !!(resumeData.avatar && !resumeData.centerTitle && isIdPhoto);
  const layoutMode = resumeData.personalInfoSection?.layout?.mode ?? "grid";
  const itemsPerRow = resumeData.personalInfoSection?.layout?.itemsPerRow || 2;
  const isInline = layoutMode === "inline";
  const avatarShape = isIdPhoto ? "square" : (resumeData.personalInfoSection?.avatarShape === "square" ? "square" : "circle");
  const avatarShapeClasses =
    avatarShape === "square" ? "rounded-none avatar-square" : "rounded-full";
  const baseAvatarStyle = isIdPhoto ? undefined : { width: "5rem", height: "5rem" };
  const rightAvatarStyle = rightBoxHeight
    ? (isIdPhoto ? undefined : { width: rightBoxHeight, height: rightBoxHeight })
    : baseAvatarStyle;
  const headerAlignClass = resumeData.centerTitle
    ? 'flex-col items-center'
    : 'justify-between items-start';
  const shouldDistribute = hasIdPhotoHeader;
  const shouldStretchPersonalInfo =
    shouldDistribute &&
    !isInline &&
    !jobIntentionText &&
    personalInfo.length > 0;
  const personalInfoRowCount = !isInline && personalInfo.length > 0
    ? Math.ceil(personalInfo.length / itemsPerRow)
    : 0;
  const isMultiRowPersonalInfo = !isInline && personalInfoRowCount > 1;
  const shouldStyleJobIntention = !!jobIntentionText && isMultiRowPersonalInfo;
  const effectiveStretchGap = shouldStretchPersonalInfo
    ? (stretchRowGapPx ?? 0)
    : 0;
  const rowGapRem = 0.5;
  const jobIntentionBadgeStyle = {
    backgroundColor: shouldStyleJobIntention ? "#F5F6F8" : undefined,
    padding: shouldStyleJobIntention ? "4px 8px" : undefined,
    borderRadius: shouldStyleJobIntention ? "4px" : undefined,
    display: "block",
    width: "100%",
    boxSizing: "border-box" as const,
  };
  const jobIntentionWrapStyle = jobIntentionText
    ? {
      width: "100%",
      whiteSpace: "nowrap" as const,
      overflow: "hidden",
    }
    : undefined;
  const jobIntentionTextStyle = jobIntentionText
    ? {
      transform: `scaleX(${jobIntentionScale})`,
      transformOrigin: `${resumeData.centerTitle ? "center" : "left"} center`,
      display: "inline-block",
      fontSize: `${jobIntentionFontScale}em`,
    }
    : undefined;

  useLayoutEffect(() => {
    if (!leftRef.current) return;
    const el = leftRef.current;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const h = Math.max(0, rect.height || el.scrollHeight || 0);
      setRightBoxHeight(h);

      if (!shouldStretchPersonalInfo || !titleRef.current || !personalGridRef.current || personalInfoRowCount === 0) {
        if (stretchRowGapPx !== undefined) {
          setStretchRowGapPx(undefined);
        }
        return;
      }

      const avatarHeight = rightRef.current?.getBoundingClientRect().height || 0;
      if (avatarHeight > 0) {
        if (idPhotoHeight === undefined || Math.abs(avatarHeight - idPhotoHeight) > 0.5) {
          setIdPhotoHeight(avatarHeight);
        }
      } else if (idPhotoHeight !== undefined) {
        setIdPhotoHeight(undefined);
      }
      const targetHeight = avatarHeight > 0 ? avatarHeight : h;
      const titleHeight = titleRef.current.getBoundingClientRect().height || 0;
      const gridRect = personalGridRef.current.getBoundingClientRect();
      const currentGap = stretchRowGapPx ?? 0;
      const contentHeight = Math.max(0, gridRect.height - currentGap * personalInfoRowCount);
      const available = Math.max(0, targetHeight - titleHeight);
      const nextGap = Math.max(0, (available - contentHeight) / personalInfoRowCount);

      if (Number.isFinite(nextGap) && Math.abs(nextGap - currentGap) > 0.5) {
        setStretchRowGapPx(nextGap);
      }

      if (jobIntentionBadgeRef.current && jobIntentionTextRef.current) {
        const badgeWidth = jobIntentionBadgeRef.current.clientWidth || 0;
        const computed = getComputedStyle(jobIntentionBadgeRef.current);
        const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0;
        const paddingRight = Number.parseFloat(computed.paddingRight) || 0;
        const wrapWidth = Math.max(0, badgeWidth - paddingLeft - paddingRight);
        const textWidth = jobIntentionTextRef.current.scrollWidth || 0;
        if (wrapWidth > 0 && textWidth > 0) {
          const baseWidth = textWidth / Math.max(0.01, jobIntentionFontScale);
          const desiredScale = Math.min(1, wrapWidth / baseWidth);
          const minFontScale = 0.92;
          let nextFontScale = 1;
          let nextScaleX = 1;

          if (desiredScale >= 1) {
            nextFontScale = 1;
            nextScaleX = 1;
          } else if (desiredScale >= minFontScale) {
            nextFontScale = desiredScale;
            nextScaleX = 1;
          } else {
            nextFontScale = minFontScale;
            nextScaleX = Math.max(0.01, desiredScale / minFontScale);
          }

          if (Math.abs(nextFontScale - jobIntentionFontScale) > 0.01) {
            setJobIntentionFontScale(nextFontScale);
          }
          if (Math.abs(nextScaleX - jobIntentionScale) > 0.01) {
            setJobIntentionScale(nextScaleX);
          }
        }
      } else {
        if (jobIntentionScale !== 1) setJobIntentionScale(1);
        if (jobIntentionFontScale !== 1) setJobIntentionFontScale(1);
      }
    };
    // 初次 + 多轮调度，确保收缩场景也能捕获（如列数减少、模块隐藏）
    measure();
    const raf = requestAnimationFrame(measure);
    const t1 = setTimeout(measure, 0);
    const t2 = setTimeout(measure, 60);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined;
    if (ro) {
      ro.observe(el);
      if (rightRef.current) ro.observe(rightRef.current);
    }
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => requestAnimationFrame(measure)) : undefined;
    if (mo) mo.observe(el, { subtree: true, childList: true, characterData: true, attributes: true });
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      if (ro) ro.disconnect();
      if (mo) mo.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [
    resumeData.centerTitle,
    resumeData.title,
    resumeData.personalInfoSection?.layout?.mode,
    resumeData.personalInfoSection?.layout?.itemsPerRow,
    resumeData.personalInfoSection?.personalInfo?.length,
    resumeData.jobIntentionSection?.enabled,
    resumeData.jobIntentionSection?.items?.length,
    shouldStretchPersonalInfo,
    personalInfoRowCount,
    stretchRowGapPx,
    idPhotoHeight,
    jobIntentionText,
    jobIntentionScale,
    jobIntentionFontScale,
  ]);

  return (
    <div
      className="resume-preview resume-content"
      style={themeColor ? ({ ["--resume-accent" as string]: themeColor } as React.CSSProperties) : undefined}
      onClick={interactive ? () => onSelect?.(null) : undefined}
    >
      {/* 头部信息 */}
      <div className={`flex mb-6 ${headerAlignClass}`}>
        {/* 居中标题模式下，头像置于最上方并居中显示 */}
        {resumeData.centerTitle && resumeData.avatar && (
          <div className="mb-4">
            <img
              src={resumeData.avatar}
              alt="头像"
              className={`resume-avatar ${avatarShapeClasses} ${isIdPhoto ? "is-id-photo" : ""} object-cover border-2 border-border box-border mx-auto`}
              style={baseAvatarStyle}
            />
          </div>
        )}

        <div
          ref={leftRef}
          className={`flex-1 flex flex-col resume-header-left ${shouldDistribute ? "is-id-photo id-photo-distribute" : ""} ${resumeData.centerTitle ? 'w-full' : ''}`}
          style={shouldStretchPersonalInfo ? { justifyContent: 'flex-start', minHeight: idPhotoHeight } : undefined}
        >
          <h1
            ref={titleRef}
            data-target-id="title"
            className={`resume-title text-2xl font-bold text-foreground ${shouldStretchPersonalInfo ? 'mb-0' : 'mb-4'} ${resumeData.centerTitle ? 'text-center' : ''} ${selClass("title")}`}
            onClick={(e) => pick(e, { kind: "title", id: "title", label: "简历标题", text: resumeData.title })}
          >
            {resumeData.title || "简历标题"}
            <SelectionBubble selection={{ kind: "title", id: "title", label: "简历标题", text: resumeData.title }} />
          </h1>

          {/* 求职意向 */}
          {jobIntentionText && (
            <div
              ref={jobIntentionWrapRef}
              data-target-id="jobIntention"
              className={`job-intention-line text-sm text-muted-foreground mb-3 ${resumeData.centerTitle ? 'text-center' : ''} ${selClass("jobIntention")}`}
              style={jobIntentionWrapStyle}
              onClick={(e) =>
                pick(e, {
                  kind: "jobIntention",
                  id: "jobIntention",
                  label: "求职意向",
                  text: jobIntentionText,
                })
              }
            >
              <span ref={jobIntentionBadgeRef} style={jobIntentionBadgeStyle}>
                <span ref={jobIntentionTextRef} style={jobIntentionTextStyle}>
                  {jobIntentionText}
                </span>
              </span>
              <SelectionBubble
                selection={{
                  kind: "jobIntention",
                  id: "jobIntention",
                  label: "求职意向",
                  text: jobIntentionText,
                }}
              />
            </div>
          )}

          {/* 个人信息 */}
          {shouldDistribute ? (
            isInline ? (
              <div
                data-target-id="personal"
                className={`personal-info personal-info-row flex items-center justify-between w-full whitespace-nowrap ${selClass("personal")}`}
                style={{ backgroundColor: '#F5F6F8', padding: '8px 12px', borderRadius: '4px' }}
                onClick={(e) =>
                  pick(e, {
                    kind: "personal",
                    id: "personal",
                    label: "个人信息",
                    text: personalInfo.map((item) => `${item.label}:${item.value.content}`).join(" "),
                  })
                }
              >
                {personalInfo.map((item) => (
                  <div
                    key={item.id}
                    className="personal-info-item flex items-center gap-0.5 shrink-0 whitespace-nowrap"
                  >
                    {item.icon && (
                      <svg
                        className="resume-icon w-[1em] h-[1em] shrink-0"
                        fill="black"
                        viewBox="0 0 24 24"
                        dangerouslySetInnerHTML={{ __html: item.icon }}
                      />
                    )}
                    {resumeData.personalInfoSection?.showPersonalInfoLabels !== false && (
                      <span className="text-sm leading-none text-muted-foreground shrink-0">{item.label}{'：'}</span>
                    )}
                    {item.value.type === "link" && item.value.content ? (
                      <a
                        href={item.value.content}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`text-sm leading-none text-blue-600 hover:text-blue-800 hover:underline ${isAsciiOnly(item.value.title || item.value.content) ? 'font-latin' : ''}`}
                      >
                        {item.value.title || "点击访问"}
                      </a>
                    ) : (
                      <span className={`text-sm leading-none text-foreground ${isAsciiOnly(item.value.content) ? 'font-latin' : ''}`}>{item.value.content || "未填写"}</span>
                    )}
                  </div>
                ))}
                <SelectionBubble
                  selection={{
                    kind: "personal",
                    id: "personal",
                    label: "个人信息",
                    text: personalInfo.map((item) => `${item.label}:${item.value.content}`).join(" "),
                  }}
                />
              </div>
            ) : (
              <div
                data-target-id="personal"
                className={`personal-info-stretch-wrapper w-full ${selClass("personal")}`}
                style={shouldStretchPersonalInfo ? { minHeight: 0 } : undefined}
                onClick={(e) =>
                  pick(e, {
                    kind: "personal",
                    id: "personal",
                    label: "个人信息",
                    text: personalInfo.map((item) => `${item.label}:${item.value.content}`).join(" "),
                  })
                }
              >
                <div
                  ref={personalGridRef}
                  className="personal-info-row personal-info-grid w-full whitespace-nowrap"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${itemsPerRow}, max-content)`,
                    justifyContent: 'space-between',
                    justifyItems: 'start',
                    alignItems: 'center',
                    columnGap: 0,
                    rowGap: shouldStretchPersonalInfo ? `${effectiveStretchGap}px` : `${rowGapRem}rem`,
                    alignContent: 'start',
                    paddingTop: shouldStretchPersonalInfo ? `${effectiveStretchGap}px` : undefined,
                    boxSizing: shouldStretchPersonalInfo ? 'border-box' : undefined,
                    width: '100%',
                  }}
                >
                  {personalInfo.map((item) => (
                    <div
                      key={item.id}
                      className="personal-info-item inline-flex items-center gap-0.5 whitespace-nowrap"
                    >
                      {item.icon && (
                        <svg
                          className="resume-icon w-[1em] h-[1em] flex-shrink-0"
                          fill="black"
                          viewBox="0 0 24 24"
                          dangerouslySetInnerHTML={{ __html: item.icon }}
                        />
                      )}
                      {resumeData.personalInfoSection?.showPersonalInfoLabels !== false && (
                        <span className="text-sm leading-none text-muted-foreground flex-shrink-0">{item.label}{'：'}</span>
                      )}
                      {item.value.type === "link" && item.value.content ? (
                        <a
                          href={item.value.content}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`text-sm leading-none text-blue-600 hover:text-blue-800 hover:underline ${isAsciiOnly(item.value.title || item.value.content) ? 'font-latin' : ''}`}
                        >
                          {item.value.title || "点击访问"}
                        </a>
                      ) : (
                        <span className={`text-sm leading-none text-foreground ${isAsciiOnly(item.value.content) ? 'font-latin' : ''}`}>{item.value.content || "未填写"}</span>
                      )}
                    </div>
                  ))}
                </div>
                <SelectionBubble
                  selection={{
                    kind: "personal",
                    id: "personal",
                    label: "个人信息",
                    text: personalInfo.map((item) => `${item.label}:${item.value.content}`).join(" "),
                  }}
                />
              </div>
            )
          ) : isInline ? (
            <div
              data-target-id="personal"
              className={`personal-info flex items-center justify-between w-full whitespace-nowrap ${selClass("personal")}`}
              style={{ backgroundColor: '#F5F6F8', padding: '8px 12px', borderRadius: '4px' }}
              onClick={(e) =>
                pick(e, {
                  kind: "personal",
                  id: "personal",
                  label: "个人信息",
                  text: personalInfo.map((item) => `${item.label}:${item.value.content}`).join(" "),
                })
              }
            >
              {personalInfo.map((item) => (
                <div
                  key={item.id}
                  className="personal-info-item flex items-center gap-0.5 shrink-0 whitespace-nowrap"
                >
                  {item.icon && (
                    <svg
                      className="resume-icon w-[1em] h-[1em] shrink-0"
                      fill="black"
                      viewBox="0 0 24 24"
                      dangerouslySetInnerHTML={{ __html: item.icon }}
                    />
                  )}
                  {resumeData.personalInfoSection?.showPersonalInfoLabels !== false && (
                    <span className="text-sm leading-none text-muted-foreground shrink-0">{item.label}{'：'}</span>
                  )}
                  {item.value.type === "link" && item.value.content ? (
                    <a
                      href={item.value.content}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`text-sm leading-none text-blue-600 hover:text-blue-800 hover:underline ${isAsciiOnly(item.value.title || item.value.content) ? 'font-latin' : ''}`}
                    >
                      {item.value.title || "点击访问"}
                    </a>
                  ) : (
                    <span className={`text-sm leading-none text-foreground ${isAsciiOnly(item.value.content) ? 'font-latin' : ''}`}>{item.value.content || "未填写"}</span>
                  )}
                </div>
              ))}
              <SelectionBubble
                selection={{
                  kind: "personal",
                  id: "personal",
                  label: "个人信息",
                  text: personalInfo.map((item) => `${item.label}:${item.value.content}`).join(" "),
                }}
              />
            </div>
          ) : (
            (() => {
              const personalSelection: WorkspaceSelection = {
                kind: "personal",
                id: "personal",
                label: "个人信息",
                text: personalInfo.map((item) => `${item.label}:${item.value.content}`).join(" "),
              }
              return (
                <div
                  data-target-id="personal"
                  className={`personal-info personal-info-grid ${selClass("personal")}`}
                  onClick={(e) => pick(e, personalSelection)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${itemsPerRow}, max-content)`,
                    justifyContent: 'space-between',
                    justifyItems: 'start',
                    alignItems: 'center',
                    columnGap: 0,
                    rowGap: `${rowGapRem}rem`,
                    width: '100%'
                  }}
                >
                  {personalInfo.map((item) => (
                    <div
                      key={item.id}
                      className="personal-info-item inline-flex items-center gap-0.5 whitespace-nowrap"
                    >
                      {item.icon && (
                        <svg
                          className="resume-icon w-[1em] h-[1em] flex-shrink-0"
                          fill="black"
                          viewBox="0 0 24 24"
                          dangerouslySetInnerHTML={{ __html: item.icon }}
                        />
                      )}
                      {resumeData.personalInfoSection?.showPersonalInfoLabels !== false && (
                        <span className="text-sm leading-none text-muted-foreground flex-shrink-0">{item.label}{'：'}</span>
                      )}
                      {item.value.type === "link" && item.value.content ? (
                        <a
                          href={item.value.content}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`text-sm leading-none text-blue-600 hover:text-blue-800 hover:underline ${isAsciiOnly(item.value.title || item.value.content) ? 'font-latin' : ''}`}
                        >
                          {item.value.title || "点击访问"}
                        </a>
                      ) : (
                        <span className={`text-sm leading-none text-foreground ${isAsciiOnly(item.value.content) ? 'font-latin' : ''}`}>{item.value.content || "未填写"}</span>
                      )}
                    </div>
                  ))}
                  <SelectionBubble selection={personalSelection} />
                </div>
              );
            })()
          )}
        </div>

        {/* 头像：左右布局时放在右侧，并在父容器高度内垂直居中 */}
        {resumeData.avatar && !resumeData.centerTitle && (
          <div
            ref={rightRef}
            className={`ml-6 flex items-start shrink-0 resume-avatar-wrapper ${isIdPhoto ? "is-id-photo" : ""}`}
          >
            <img
              src={resumeData.avatar}
              alt="头像"
              className={`resume-avatar ${avatarShapeClasses} ${isIdPhoto ? "is-id-photo" : ""} object-cover border-2 border-border box-border`}
              style={rightAvatarStyle}
            />
          </div>
        )}
      </div>

      {/* 简历模块 */}
      <div className="space-y-6">
        {orderedModules
          .map((module) => (
            <div key={module.id} className="resume-module" data-module-id={module.id}>
              <div
                className={`module-title text-lg font-semibold text-foreground border-b border-border pb-2 mb-3 flex items-center gap-2 ${selClass(module.id)}`}
                style={themeColor ? { color: themeColor, borderBottomColor: themeColor } : undefined}
                data-role="module-title"
                onClick={(e) => pick(e, { kind: "module", id: module.id, label: `模块「${module.title}」` })}
              >
                {module.icon && (
                  <svg
                    width={20}
                    height={20}
                    viewBox="0 0 24 24"
                    dangerouslySetInnerHTML={{ __html: module.icon }}
                  />
                )}
                {module.title}
                <SelectionBubble selection={{ kind: "module", id: module.id, label: `模块「${module.title}」` }} />
              </div>

              <div className="space-y-[0.3em]">
                {/* 渲染行 */}
                {module.rows
                  .map((row, rowIdx) => (
                    row.type === 'tags' ? (
                      <div
                        key={row.id}
                        data-row-id={row.id}
                        className={`flex flex-wrap gap-1 items-center mb-1 ${selClass(row.id)}`}
                        onClick={(e) => pick(e, { kind: "row", id: row.id, moduleId: module.id, label: `「${module.title}」· 标签`, text: (row.tags || []).join("、") })}
                      >
                        {(row.tags || []).slice(0, 20).map((tag, idx) => (
                          <span key={`${row.id}-tag-${idx}`} className="inline-flex items-center border border-gray-300 rounded-full px-2 py-0.5 text-xs text-gray-600">
                            {tag}
                          </span>
                        ))}
                        <SelectionBubble selection={{ kind: "row", id: row.id, moduleId: module.id, label: `「${module.title}」· 标签`, text: (row.tags || []).join("、") }} />
                      </div>
                    ) : (
                      <div key={row.id} className="relative" data-row-id={row.id}>
                        <div
                          className={`grid gap-3 items-center ${selClass(row.id)}`}
                          style={{
                            gridTemplateColumns: `repeat(${row.columns}, 1fr)`,
                          }}
                          onClick={(e) =>
                            pick(e, {
                              kind: "row",
                              id: row.id,
                              moduleId: module.id,
                              label: `「${module.title}」· 第${rowIdx + 1}行`,
                              text: row.elements.map((element) => docToText(element.content)).join("\n"),
                            })
                          }
                        >
                          {row.elements.map((element) => {
                            const label = `「${module.title}」· 第${rowIdx + 1}行 · 第${element.columnIndex + 1}列`
                            const selection: WorkspaceSelection = {
                              kind: "element",
                              id: element.id,
                              moduleId: module.id,
                              rowId: row.id,
                              label,
                              text: docToText(element.content),
                            }
                            return (
                              <div
                                key={element.id}
                                data-element-id={element.id}
                                className={`text-sm text-foreground ${selClass(element.id)}`}
                                onClick={(e) => pick(e, selection)}
                              >
                                <RichTextRenderer content={element.content} />
                                <SelectionBubble selection={selection} />
                              </div>
                            )
                          })}
                        </div>
                        <SelectionBubble
                          selection={{
                            kind: "row",
                            id: row.id,
                            moduleId: module.id,
                            label: `「${module.title}」· 第${rowIdx + 1}行`,
                            text: row.elements.map((element) => docToText(element.content)).join("\n"),
                          }}
                        />
                      </div>
                    )
                  ))}
              </div>
            </div>
          ))}
      </div>

      {/* 空状态提示 */}
      {orderedModules.length === 0 && (
        <div className="text-center py-12 text-muted-foreground no-print">
          <Icon
            icon="mdi:file-document-outline"
            className="w-12 h-12 mx-auto mb-4 opacity-50"
          />
          <p>暂无简历内容，请在左侧编辑区域添加模块</p>
        </div>
      )}
    </div>
  );
}
