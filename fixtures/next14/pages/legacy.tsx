import type {GetServerSideProps} from "next";
export const getServerSideProps: GetServerSideProps = async () => ({props: {ok: true}});
export default function Legacy({ok}: {ok: boolean}) { return <main>next14-pages-{String(ok)}</main>; }
