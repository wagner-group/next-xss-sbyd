import {forwardRef} from "react";
import type {AnchorHTMLAttributes, ComponentPropsWithoutRef, ElementType, ForwardRefExoticComponent, ReactElement, ReactNode, Ref, RefAttributes} from "react";
import * as ImageModule from "next/dist/shared/lib/image-external.js";
import * as LinkModule from "next/dist/client/link.js";
import type {LinkProps} from "next/dist/client/link.js";
import type {ImageProps} from "next/dist/shared/lib/image-external.js";
import {guardJsxProps} from "./jsx-guard.js";
import {
  validateImageSource,
  validateIntrinsicUrlProps,
  validateNavigationTarget,
} from "./url-sinks.js";

type NextLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & LinkProps & {children?: ReactNode};
type NextImageProps = Omit<ImageProps, "key">;

function moduleDefault<T>(module: {default: unknown}): T {
  const first = module.default;
  if (first !== null && typeof first === "object" && !("$$typeof" in first) && "default" in first) {
    return first.default as T;
  }
  return first as T;
}

const NextImage = moduleDefault<ForwardRefExoticComponent<NextImageProps & RefAttributes<HTMLImageElement>>>(ImageModule);
const NextLink = moduleDefault<ForwardRefExoticComponent<NextLinkProps & RefAttributes<HTMLAnchorElement>>>(LinkModule);

function renderLink(props: NextLinkProps, ref: Ref<HTMLAnchorElement>): ReactElement {
  const guarded = guardJsxProps(SafeLink, props as unknown as Record<string, unknown>);
  const {href, as, ...rest} = guarded as unknown as NextLinkProps;
  return <NextLink {...rest} href={validateNavigationTarget(href)} as={validateNavigationTarget(as)} ref={ref} />;
}

function renderImage(props: NextImageProps, ref: Ref<HTMLImageElement>): ReactElement {
  const {src, overrideSrc, ...rest} = guardJsxProps(SafeImage, props as Record<string, unknown>) as NextImageProps;
  return <NextImage {...rest} src={validateImageSource(src)}
    overrideSrc={validateImageSource(overrideSrc)} ref={ref} />;
}

/** Alias-safe replacement for next/link that validates href and as. */
export const SafeLink = forwardRef(renderLink);
/** Alias-safe replacement for next/image that validates string sources. */
export const SafeImage = forwardRef(renderImage);

type IntrinsicName = "a" | "area" | "audio" | "button" | "form" | "img" | "input" | "source" | "track" | "video";

function intrinsic<T extends IntrinsicName>(tag: T) {
  type Props = ComponentPropsWithoutRef<T>;
  type Instance = T extends "a" ? HTMLAnchorElement : T extends "area" ? HTMLAreaElement :
    T extends "audio" ? HTMLAudioElement : T extends "button" ? HTMLButtonElement :
    T extends "form" ? HTMLFormElement : T extends "img" ? HTMLImageElement :
    T extends "input" ? HTMLInputElement : T extends "source" ? HTMLSourceElement :
    T extends "track" ? HTMLTrackElement : HTMLVideoElement;
  function ValidatedIntrinsic(props: Props, ref: Ref<Instance>): ReactElement {
    const validated = validateIntrinsicUrlProps(tag, guardJsxProps(tag, props as Record<string, unknown>));
    const Type = tag as ElementType;
    return <Type {...validated} ref={ref} />;
  }
  return forwardRef(ValidatedIntrinsic);
}

/** Validating anchor wrapper. */
export const SafeAnchor = intrinsic("a");
/** Validating image wrapper. */
export const SafeImg = intrinsic("img");
/** Validating video wrapper. */
export const SafeVideo = intrinsic("video");
/** Validating audio wrapper. */
export const SafeAudio = intrinsic("audio");
/** Validating source wrapper. */
export const SafeSource = intrinsic("source");
/** Validating area wrapper. */
export const SafeArea = intrinsic("area");
/** Validating track wrapper. */
export const SafeTrack = intrinsic("track");

export const A = SafeAnchor;
export const Area = SafeArea;
export const Audio = SafeAudio;
export const Form = intrinsic("form");
export const Img = SafeImg;
export const Source = SafeSource;
export const Track = SafeTrack;
export const Video = SafeVideo;
