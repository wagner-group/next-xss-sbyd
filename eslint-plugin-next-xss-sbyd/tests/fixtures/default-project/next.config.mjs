import React from "react";

const props = {dangerouslySetInnerHTML: {__html: "unsafe"}};
React.createElement("div", props);

export default {};
