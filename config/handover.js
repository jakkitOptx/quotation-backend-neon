// These mappings are used only by the handover feature. They do not change
// document types or labels returned by other quotation APIs.
module.exports = {
  companiesByEmailDomain: {
    "optx.co.th": { code: "OPTX", name: "บริษัท ออพท์เอ็กซ์ จำกัด" },
    "neonworks.co.th": { code: "NEON", name: "บริษัท นีออน เวิร์คส์ จำกัด" },
    "neonworks.com": { code: "NEON", name: "บริษัท นีออน เวิร์คส์ จำกัด" },
  },
  workTypesByCompany: {
    NEON: {
      C: "Creative",
      G: "General",
      K: "Kols",
      M: "Media",
      P: "Production",
      S: "Strategy",
      V: "Vertix",
    },
    OPTX: {
      M: "Biddable Media",
      S: "SEO",
      W: "Website",
      D: "Database",
    },
  },
  // A document can retain a historical/legacy type even when the current
  // issuer-company mapping does not list it. Use a fallback only for codes
  // whose label is unambiguous across the supplied company mappings.
  uniqueWorkTypes: {
    C: "Creative",
    G: "General",
    K: "Kols",
    M: "Biddable Media",
    P: "Production",
    V: "Vertix",
    W: "Website",
    D: "Database",
  },
};
