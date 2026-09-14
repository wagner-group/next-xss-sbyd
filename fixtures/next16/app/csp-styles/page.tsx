import {StyleRecipes} from "./recipes";

/** Exercises the non-hash recipes under the production policy. */
export default function StylesPage() {
  return <StyleRecipes next={false} />;
}
