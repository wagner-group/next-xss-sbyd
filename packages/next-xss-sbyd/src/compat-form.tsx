import {forwardRef} from "react";
import type {ForwardRefExoticComponent, ReactElement, Ref, RefAttributes} from "react";
import * as FormModule from "next/dist/client/form.js";
import type {FormProps} from "next/dist/client/form.js";
import {guardJsxProps} from "./jsx-guard.js";
import {validateFormTarget} from "./url-sinks.js";

type NextFormProps = Omit<FormProps, "key">;

function moduleDefault<T>(module: {default: unknown}): T {
  const first = module.default;
  if (first !== null && typeof first === "object" && !("$$typeof" in first) && "default" in first) {
    return first.default as T;
  }
  return first as T;
}

const NextForm = moduleDefault<ForwardRefExoticComponent<NextFormProps & RefAttributes<HTMLFormElement>>>(FormModule);

function renderForm(props: NextFormProps, ref: Ref<HTMLFormElement>): ReactElement {
  const {action, ...rest} = guardJsxProps(SafeForm, props as Record<string, unknown>) as NextFormProps;
  return <NextForm {...rest} action={validateFormTarget(action)} ref={ref} />;
}

/** Alias-safe replacement for next/form that validates string actions. */
export const SafeForm = forwardRef(renderForm);

export default SafeForm;
