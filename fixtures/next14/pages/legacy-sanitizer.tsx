import type {GetServerSideProps} from "next";
import SanitizerLifecycle from "../app/sanitizer-lifecycle/client";
export const getServerSideProps: GetServerSideProps = async () => ({props: {}});
export default SanitizerLifecycle;
