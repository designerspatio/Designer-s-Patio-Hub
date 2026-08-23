import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function env(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing server environment variable: ${name}`
    );
  }
  return value;
}

function publicSupabase() {
  return createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

function adminSupabase() {
  return createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

async function authenticatedHubUser(request: Request) {
  const authorization =
    request.headers.get("authorization") || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice(7).trim();
  if (!token) return null;

  const supabase = publicSupabase();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) return null;
  return user;
}

function outputText(payload: any) {
  if (typeof payload?.output_text === "string") {
    return payload.output_text;
  }

  const pieces: string[] = [];

  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (
        content?.type === "output_text" &&
        typeof content?.text === "string"
      ) {
        pieces.push(content.text);
      }
    }
  }

  return pieces.join("\n");
}

async function openAiStructured(input: {
  prompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  fileUrl?: string | null;
  fileName?: string | null;
  modelEnv?: string;
  defaultModel?: string;
  maxOutputTokens?: number;
}) {
  let apiKey = "";

  try {
    apiKey = env("OPENAI_API_KEY");
  } catch {
    throw Object.assign(
      new Error(
        "AI library tools are built, but OPENAI_API_KEY has not been added to Vercel yet."
      ),
      {
        setupRequired: "OPENAI_API_KEY",
        status: 503,
      }
    );
  }

  const model =
    process.env[input.modelEnv || "OPENAI_LIBRARY_MODEL"]?.trim() ||
    input.defaultModel ||
    "gpt-5.6-terra";

  const content: Array<Record<string, unknown>> = [];

  if (input.fileUrl) {
    content.push({
      type: "input_file",
      file_url: input.fileUrl,
      ...(input.fileName
        ? { filename: input.fileName }
        : {}),
    });
  }

  content.push({
    type: "input_text",
    text: input.prompt,
  });

  const response = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        input: [
          {
            role: "user",
            content,
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: input.schemaName,
            strict: true,
            schema: input.schema,
          },
        },
        ...(input.maxOutputTokens
          ? {
              max_output_tokens:
                input.maxOutputTokens,
            }
          : {}),
      }),
      cache: "no-store",
    }
  );

  const payload = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.error ||
      `OpenAI request failed (${response.status}).`;

    throw Object.assign(
      new Error(message),
      {
        status: response.status,
      }
    );
  }

  const text = outputText(payload);

  if (!text) {
    throw new Error(
      "The AI request completed without returning structured data."
    );
  }

  try {
    return {
      model,
      data: JSON.parse(text),
    };
  } catch {
    throw new Error(
      "The AI response could not be read as structured data."
    );
  }
}

function numberOrNull(value: unknown) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;

  return Math.round(parsed * 100) / 100;
}

function cleanText(
  value: unknown,
  max = 4000
) {
  const result =
    String(value ?? "").trim();

  return result
    ? result.slice(0, max)
    : null;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function finderTerms(value: string) {
  const ignored = new Set([
    "a",
    "an",
    "and",
    "the",
    "for",
    "with",
    "that",
    "this",
    "of",
    "to",
    "in",
    "on",
    "under",
    "over",
    "around",
    "about",
    "show",
    "find",
    "me",
    "need",
    "want",
  ]);

  return Array.from(
    new Set(
      normalizeText(value)
        .split(" ")
        .filter(
          (term) =>
            term.length > 1 &&
            !ignored.has(term)
        )
    )
  );
}

async function signedLibraryUrl(
  bucket: "catalogs" | "price-lists",
  filePath: string
) {
  const admin = adminSupabase();

  const { data, error } =
    await admin.storage
      .from(bucket)
      .createSignedUrl(
        filePath,
        15 * 60
      );

  if (
    error ||
    !data?.signedUrl
  ) {
    throw new Error(
      error?.message ||
        "The source PDF could not be opened for AI processing."
    );
  }

  return data.signedUrl;
}

async function insertInChunks(
  table: string,
  rows: Record<string, unknown>[],
  chunkSize = 150
) {
  const admin = adminSupabase();

  for (
    let index = 0;
    index < rows.length;
    index += chunkSize
  ) {
    const chunk = rows.slice(
      index,
      index + chunkSize
    );

    const { error } =
      await admin
        .from(table)
        .insert(chunk);

    if (error) {
      throw new Error(
        `Could not save AI-imported rows: ${error.message}`
      );
    }
  }
}

const catalogSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    document_title: {
      type: ["string", "null"],
    },
    document_year: {
      type: ["number", "null"],
    },
    overall_confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    notes: {
      type: "string",
    },
    products: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sku: {
            type: ["string", "null"],
          },
          product_name: {
            type: "string",
          },
          collection: {
            type: ["string", "null"],
          },
          category: {
            type: ["string", "null"],
          },
          description: {
            type: ["string", "null"],
          },
          dimensions: {
            type: ["string", "null"],
          },
          materials: {
            type: ["string", "null"],
          },
          finishes: {
            type: ["string", "null"],
          },
          fabrics: {
            type: ["string", "null"],
          },
          features: {
            type: ["string", "null"],
          },
          source_page: {
            type: ["string", "null"],
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
        },
        required: [
          "sku",
          "product_name",
          "collection",
          "category",
          "description",
          "dimensions",
          "materials",
          "finishes",
          "fabrics",
          "features",
          "source_page",
          "confidence",
        ],
      },
    },
  },
  required: [
    "document_title",
    "document_year",
    "overall_confidence",
    "notes",
    "products",
  ],
};

const priceListSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    document_title: {
      type: ["string", "null"],
    },
    version: {
      type: ["string", "null"],
    },
    effective_date: {
      type: ["string", "null"],
    },
    overall_confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    notes: {
      type: "string",
    },
    prices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sku: {
            type: "string",
          },
          product_name: {
            type: ["string", "null"],
          },
          collection: {
            type: ["string", "null"],
          },
          description: {
            type: ["string", "null"],
          },
          grade: {
            type: ["string", "null"],
          },
          msrp: {
            type: "number",
          },
          source_page: {
            type: ["string", "null"],
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
        },
        required: [
          "sku",
          "product_name",
          "collection",
          "description",
          "grade",
          "msrp",
          "source_page",
          "confidence",
        ],
      },
    },
  },
  required: [
    "document_title",
    "version",
    "effective_date",
    "overall_confidence",
    "notes",
    "prices",
  ],
};

const finderSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    interpretation: {
      type: "string",
    },
    rankings: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          catalog_item_id: {
            type: "string",
          },
          relevance_score: {
            type: "number",
            minimum: 0,
            maximum: 100,
          },
          reason: {
            type: "string",
          },
          matched_terms: {
            type: "array",
            items: {
              type: "string",
            },
          },
        },
        required: [
          "catalog_item_id",
          "relevance_score",
          "reason",
          "matched_terms",
        ],
      },
    },
  },
  required: [
    "interpretation",
    "rankings",
  ],
};

async function ingestCatalog(
  catalogId: string,
  userId: string
) {
  const admin = adminSupabase();

  const {
    data: catalog,
    error: catalogError,
  } = await admin
    .from("catalogs")
    .select(
      "id,manufacturer_id,title,catalog_year,file_name,file_path,active"
    )
    .eq("id", catalogId)
    .single();

  if (
    catalogError ||
    !catalog
  ) {
    throw Object.assign(
      new Error(
        catalogError?.message ||
          "Catalog not found."
      ),
      { status: 404 }
    );
  }

  if (!catalog.file_path) {
    throw Object.assign(
      new Error(
        "Upload a catalog PDF before running AI Import."
      ),
      { status: 409 }
    );
  }

  const {
    data: manufacturer,
  } = await admin
    .from("manufacturers")
    .select("id,name")
    .eq(
      "id",
      catalog.manufacturer_id
    )
    .maybeSingle();

  const signedUrl =
    await signedLibraryUrl(
      "catalogs",
      catalog.file_path
    );

  const prompt = [
    "Extract the structured product catalog from this PDF.",
    "This is an outdoor furniture manufacturer's catalog.",
    "Return one record per distinct sellable product/model shown in the document.",
    "Use only facts visible in the PDF. Never invent SKUs, dimensions, materials, finishes, fabrics, features, collection names, categories, or page numbers.",
    "Do not create records for table-of-contents entries, lifestyle photography, section dividers, warranties, care instructions, company information, or generic finish/fabric swatches unless they belong to a specific product record.",
    "When a product has multiple sizes with distinct SKUs, return separate records. When variants share one SKU/model, keep one record and summarize variants in the appropriate fields.",
    "source_page should be the printed or PDF page number when identifiable.",
    "Keep descriptions concise but useful for semantic product search.",
    "Extract at most 750 product records. If the document contains more, prioritize actual product/model entries and mention truncation in notes.",
    `Expected manufacturer: ${manufacturer?.name || "Unknown"}`,
    `Hub catalog title: ${catalog.title}`,
    `Hub catalog year: ${catalog.catalog_year ?? "Unknown"}`,
  ].join("\n");

  const ai =
    await openAiStructured({
      prompt,
      schemaName:
        "designer_patio_catalog_import",
      schema: catalogSchema,
      fileUrl: signedUrl,
      fileName:
        catalog.file_name ||
        "catalog.pdf",
      modelEnv:
        "OPENAI_LIBRARY_MODEL",
      defaultModel:
        "gpt-5.6-terra",
      maxOutputTokens: 30000,
    });

  const products =
    Array.isArray(
      ai.data?.products
    )
      ? ai.data.products
      : [];

  const importedAt =
    new Date().toISOString();

  const rows =
    products
      .map((product: any) => {
        const productName =
          cleanText(
            product?.product_name,
            500
          );

        if (!productName) {
          return null;
        }

        const confidence =
          Math.max(
            0,
            Math.min(
              1,
              Number(
                product?.confidence ??
                  0
              ) || 0
            )
          );

        return {
          catalog_id:
            catalog.id,
          manufacturer_id:
            catalog.manufacturer_id,
          sku:
            cleanText(
              product?.sku,
              255
            ),
          product_name:
            productName,
          collection:
            cleanText(
              product?.collection,
              500
            ),
          category:
            cleanText(
              product?.category,
              255
            ),
          description:
            cleanText(
              product?.description,
              4000
            ),
          dimensions:
            cleanText(
              product?.dimensions,
              2000
            ),
          materials:
            cleanText(
              product?.materials,
              2000
            ),
          finishes:
            cleanText(
              product?.finishes,
              4000
            ),
          fabrics:
            cleanText(
              product?.fabrics,
              4000
            ),
          features:
            cleanText(
              product?.features,
              4000
            ),
          specifications: {
            ai_import: {
              imported_at:
                importedAt,
              imported_by:
                userId,
              model: ai.model,
              confidence,
            },
          },
          source_page:
            cleanText(
              product?.source_page,
              100
            ),
          active: true,
          created_at:
            importedAt,
          updated_at:
            importedAt,
        };
      })
      .filter(Boolean) as Record<
      string,
      unknown
    >[];

  if (!rows.length) {
    throw Object.assign(
      new Error(
        "AI did not find any usable product records in this catalog."
      ),
      { status: 422 }
    );
  }

  const { error: deleteError } =
    await admin
      .from("catalog_items")
      .delete()
      .eq(
        "catalog_id",
        catalog.id
      );

  if (deleteError) {
    throw new Error(
      `The PDF was read, but old structured catalog rows could not be replaced: ${deleteError.message}`
    );
  }

  await insertInChunks(
    "catalog_items",
    rows
  );

  await admin
    .from("catalogs")
    .update({
      updated_at: importedAt,
    })
    .eq("id", catalog.id);

  return {
    status: "success",
    library_type: "catalog",
    id: catalog.id,
    imported_count:
      rows.length,
    model: ai.model,
    overall_confidence:
      Math.max(
        0,
        Math.min(
          1,
          Number(
            ai.data
              ?.overall_confidence ??
              0
          ) || 0
        )
      ),
    notes:
      cleanText(
        ai.data?.notes,
        4000
      ),
  };
}

async function ingestPriceList(
  priceListId: string,
  userId: string
) {
  const admin = adminSupabase();

  const {
    data: priceList,
    error: priceListError,
  } = await admin
    .from("price_lists")
    .select(
      "id,manufacturer_id,title,version,effective_date,file_name,file_path,approved_for_pricing,active"
    )
    .eq("id", priceListId)
    .single();

  if (
    priceListError ||
    !priceList
  ) {
    throw Object.assign(
      new Error(
        priceListError?.message ||
          "Price List not found."
      ),
      { status: 404 }
    );
  }

  if (!priceList.file_path) {
    throw Object.assign(
      new Error(
        "Upload a price-list PDF before running AI Import."
      ),
      { status: 409 }
    );
  }

  const {
    data: manufacturer,
  } = await admin
    .from("manufacturers")
    .select("id,name")
    .eq(
      "id",
      priceList.manufacturer_id
    )
    .maybeSingle();

  const signedUrl =
    await signedLibraryUrl(
      "price-lists",
      priceList.file_path
    );

  const prompt = [
    "Extract the structured retail/MSRP price list from this PDF.",
    "This is an outdoor furniture manufacturer's price list.",
    "Return one record per SKU + grade/price combination.",
    "Use only prices explicitly shown in this exact PDF. Do not infer or calculate missing MSRP.",
    "The msrp field must be the unit MSRP for that SKU/grade, never an extended total, discount, dealer cost, freight charge, surcharge, tariff, tax, or package total.",
    "Do not include freight, surcharges, tariffs, tax, terms, finish premiums without a SKU, or explanatory text as product rows.",
    "If a SKU has Base/A/B/C/etc grade prices, return one row for each grade.",
    "If the document contains a base price plus explicit grade add-ons rather than final grade MSRP, only return the explicit base MSRP unless the final MSRP is directly printed.",
    "source_page should identify the printed/PDF page when possible.",
    "Extract at most 1000 price rows. If there are more, prioritize actual SKU price rows and mention truncation in notes.",
    `Expected manufacturer: ${manufacturer?.name || "Unknown"}`,
    `Hub price-list title: ${priceList.title}`,
    `Hub version: ${priceList.version || "Unknown"}`,
    `Hub effective date: ${priceList.effective_date || "Unknown"}`,
    "IMPORTANT: importing data must never imply that this document is approved for pricing. Approval remains a separate human-controlled Hub setting.",
  ].join("\n");

  const ai =
    await openAiStructured({
      prompt,
      schemaName:
        "designer_patio_price_list_import",
      schema: priceListSchema,
      fileUrl: signedUrl,
      fileName:
        priceList.file_name ||
        "price-list.pdf",
      modelEnv:
        "OPENAI_LIBRARY_MODEL",
      defaultModel:
        "gpt-5.6-terra",
      maxOutputTokens: 30000,
    });

  const prices =
    Array.isArray(
      ai.data?.prices
    )
      ? ai.data.prices
      : [];

  const importedAt =
    new Date().toISOString();

  const rows =
    prices
      .map((price: any) => {
        const sku =
          cleanText(
            price?.sku,
            255
          );

        const msrp =
          numberOrNull(
            price?.msrp
          );

        if (
          !sku ||
          msrp === null ||
          msrp < 0
        ) {
          return null;
        }

        return {
          price_list_id:
            priceList.id,
          manufacturer_id:
            priceList.manufacturer_id,
          sku,
          product_name:
            cleanText(
              price?.product_name,
              500
            ),
          collection:
            cleanText(
              price?.collection,
              500
            ),
          description:
            cleanText(
              price?.description,
              4000
            ),
          grade:
            cleanText(
              price?.grade,
              255
            ),
          msrp,
          notes:
            price?.source_page
              ? `AI source page: ${cleanText(
                  price.source_page,
                  100
                )}`
              : null,
          active: true,
          created_at:
            importedAt,
          updated_at:
            importedAt,
        };
      })
      .filter(Boolean) as Record<
      string,
      unknown
    >[];

  if (!rows.length) {
    throw Object.assign(
      new Error(
        "AI did not find any usable SKU/MSRP rows in this price list."
      ),
      { status: 422 }
    );
  }

  const { error: deleteError } =
    await admin
      .from("price_list_items")
      .delete()
      .eq(
        "price_list_id",
        priceList.id
      );

  if (deleteError) {
    throw new Error(
      `The PDF was read, but old structured pricing rows could not be replaced: ${deleteError.message}`
    );
  }

  await insertInChunks(
    "price_list_items",
    rows
  );

  // Deliberately do NOT alter approved_for_pricing.
  await admin
    .from("price_lists")
    .update({
      updated_at: importedAt,
    })
    .eq("id", priceList.id);

  return {
    status: "success",
    library_type:
      "price_list",
    id: priceList.id,
    imported_count:
      rows.length,
    approved_for_pricing:
      priceList.approved_for_pricing ===
      true,
    model: ai.model,
    overall_confidence:
      Math.max(
        0,
        Math.min(
          1,
          Number(
            ai.data
              ?.overall_confidence ??
              0
          ) || 0
        )
      ),
    notes:
      cleanText(
        ai.data?.notes,
        4000
      ),
  };
}

async function runFinder(
  body: any
) {
  const admin = adminSupabase();

  const prompt =
    String(
      body?.prompt || ""
    ).trim();

  const manufacturerId =
    String(
      body?.manufacturer_id ||
        ""
    ).trim();

  const categoryFilter =
    normalizeText(
      body?.category || ""
    );

  const collectionFilter =
    normalizeText(
      body?.collection || ""
    );

  const maxMsrp =
    body?.max_msrp ===
      null ||
    body?.max_msrp ===
      undefined ||
    body?.max_msrp === ""
      ? null
      : numberOrNull(
          body.max_msrp
        );

  const pricedOnly =
    body?.priced_only === true;

  if (
    !prompt &&
    !manufacturerId &&
    !categoryFilter &&
    !collectionFilter &&
    maxMsrp === null
  ) {
    throw Object.assign(
      new Error(
        "Describe what you are looking for or choose at least one Finder filter."
      ),
      { status: 400 }
    );
  }

  let catalogQuery =
    admin
      .from("catalog_items")
      .select(
        "id,catalog_id,manufacturer_id,sku,product_name,collection,category,description,dimensions,materials,finishes,fabrics,features,specifications,source_page,active,created_at,updated_at"
      )
      .eq("active", true);

  if (manufacturerId) {
    catalogQuery =
      catalogQuery.eq(
        "manufacturer_id",
        manufacturerId
      );
  }

  const {
    data: catalogItemsData,
    error: catalogItemsError,
  } = await catalogQuery.limit(
    2500
  );

  if (catalogItemsError) {
    throw new Error(
      `Could not load product knowledge: ${catalogItemsError.message}`
    );
  }

  const catalogItems =
    catalogItemsData || [];

  if (!catalogItems.length) {
    return {
      status: "success",
      interpretation: "",
      results: [],
    };
  }

  const catalogIds =
    Array.from(
      new Set(
        catalogItems.map(
          (item) =>
            item.catalog_id
        )
      )
    );

  const manufacturerIds =
    Array.from(
      new Set(
        catalogItems.map(
          (item) =>
            item.manufacturer_id
        )
      )
    );

  const [
    catalogResult,
    manufacturerResult,
    priceListResult,
  ] = await Promise.all([
    admin
      .from("catalogs")
      .select(
        "id,manufacturer_id,title,catalog_year,file_name,file_path,source_url,notes,active,created_by,created_at,updated_at"
      )
      .in("id", catalogIds),
    admin
      .from("manufacturers")
      .select(
        "id,name,default_discount_pct,purchasing_factor,tariff_pct,surcharge_pct,active"
      )
      .in(
        "id",
        manufacturerIds
      ),
    admin
      .from("price_lists")
      .select(
        "id,manufacturer_id,title,version,effective_date,expiration_date,file_name,file_path,source_url,approved_for_pricing,active,notes,created_by,created_at,updated_at"
      )
      .eq(
        "approved_for_pricing",
        true
      )
      .eq("active", true),
  ]);

  if (catalogResult.error) {
    throw new Error(
      `Could not load catalog sources: ${catalogResult.error.message}`
    );
  }

  if (manufacturerResult.error) {
    throw new Error(
      `Could not load manufacturers: ${manufacturerResult.error.message}`
    );
  }

  if (priceListResult.error) {
    throw new Error(
      `Could not load approved pricing: ${priceListResult.error.message}`
    );
  }

  const today =
    new Date()
      .toISOString()
      .slice(0, 10);

  const approvedLists =
    (priceListResult.data ||
      []).filter(
      (list) => {
        const started =
          !list.effective_date ||
          list.effective_date <=
            today;

        const unexpired =
          !list.expiration_date ||
          list.expiration_date >=
            today;

        return (
          started &&
          unexpired
        );
      }
    );

  const approvedIds =
    approvedLists.map(
      (list) => list.id
    );

  let priceItems: any[] = [];

  if (approvedIds.length) {
    const {
      data,
      error,
    } = await admin
      .from("price_list_items")
      .select(
        "id,price_list_id,manufacturer_id,sku,product_name,collection,description,grade,msrp,notes,active,created_at,updated_at"
      )
      .in(
        "price_list_id",
        approvedIds
      )
      .eq("active", true)
      .limit(6000);

    if (error) {
      throw new Error(
        `Could not load approved pricing rows: ${error.message}`
      );
    }

    priceItems = data || [];
  }

  const catalogs =
    catalogResult.data || [];

  const manufacturers =
    manufacturerResult.data || [];

  const terms =
    finderTerms(prompt);

  const priceByProductKey =
    new Map<string, any[]>();

  for (const price of
    priceItems) {
    const key = [
      price.manufacturer_id,
      normalizeText(
        price.sku
      ),
    ].join("|");

    if (
      !priceByProductKey.has(
        key
      )
    ) {
      priceByProductKey.set(
        key,
        []
      );
    }

    priceByProductKey
      .get(key)!
      .push(price);
  }

  const candidates =
    catalogItems
      .map((item) => {
        const catalog =
          catalogs.find(
            (entry) =>
              entry.id ===
              item.catalog_id
          ) || null;

        if (
          catalog &&
          catalog.active ===
            false
        ) {
          return null;
        }

        const manufacturer =
          manufacturers.find(
            (entry) =>
              entry.id ===
              item.manufacturer_id
          ) || null;

        const prices =
          item.sku
            ? (
                priceByProductKey.get(
                  [
                    item.manufacturer_id,
                    normalizeText(
                      item.sku
                    ),
                  ].join("|")
                ) || []
              )
            : [];

        const priceRows =
          prices
            .map((price) => {
              const list =
                approvedLists.find(
                  (entry) =>
                    entry.id ===
                    price.price_list_id
                );

              return {
                id: price.id,
                price_list_id:
                  price.price_list_id,
                title:
                  list?.title ||
                  "Approved Price List",
                version:
                  list?.version ||
                  null,
                grade:
                  price.grade ||
                  null,
                msrp:
                  Number(
                    price.msrp ||
                      0
                  ),
              };
            })
            .sort(
              (a, b) =>
                a.msrp -
                b.msrp
            );

        if (
          pricedOnly &&
          !priceRows.length
        ) {
          return null;
        }

        if (
          maxMsrp !== null &&
          !priceRows.some(
            (price) =>
              price.msrp <=
              maxMsrp
          )
        ) {
          return null;
        }

        const category =
          normalizeText(
            item.category
          );
        const collection =
          normalizeText(
            item.collection
          );

        if (
          categoryFilter &&
          !category.includes(
            categoryFilter
          )
        ) {
          return null;
        }

        if (
          collectionFilter &&
          !collection.includes(
            collectionFilter
          )
        ) {
          return null;
        }

        const fields = [
          item.product_name,
          item.sku,
          item.collection,
          item.category,
          item.description,
          item.dimensions,
          item.materials,
          item.finishes,
          item.fabrics,
          item.features,
          manufacturer?.name,
        ].map(normalizeText);

        const haystack =
          fields.join(" ");

        let lexicalScore = 0;

        for (const term of terms) {
          if (
            haystack.includes(
              term
            )
          ) {
            lexicalScore += 1;
          }
        }

        if (
          prompt &&
          normalizeText(
            item.product_name
          ).includes(
            normalizeText(
              prompt
            )
          )
        ) {
          lexicalScore += 4;
        }

        if (priceRows.length) {
          lexicalScore += 0.2;
        }

        return {
          item,
          catalog,
          manufacturer,
          prices: priceRows,
          lexicalScore,
        };
      })
      .filter(Boolean)
      .sort(
        (a: any, b: any) =>
          b.lexicalScore -
          a.lexicalScore
      )
      .slice(0, 120) as any[];

  if (!candidates.length) {
    return {
      status: "success",
      interpretation: "",
      results: [],
    };
  }

  const compactCandidates =
    candidates.map(
      (candidate) => ({
        id:
          candidate.item.id,
        manufacturer:
          candidate.manufacturer
            ?.name || null,
        product_name:
          candidate.item
            .product_name,
        sku:
          candidate.item.sku,
        collection:
          candidate.item
            .collection,
        category:
          candidate.item
            .category,
        description:
          candidate.item
            .description,
        dimensions:
          candidate.item
            .dimensions,
        materials:
          candidate.item
            .materials,
        finishes:
          candidate.item
            .finishes,
        fabrics:
          candidate.item
            .fabrics,
        features:
          candidate.item
            .features,
        approved_msrp:
          candidate.prices.map(
            (price: any) => ({
              grade:
                price.grade,
              msrp:
                price.msrp,
            })
          ),
      })
    );

  const aiPrompt = [
    "Act as a product-finding assistant for a luxury outdoor furniture showroom.",
    "Rank the supplied candidate products against the user's request using semantic meaning, not just exact word overlap.",
    "Consider product type, style, material, finish, fabric, dimensions, collection, features, manufacturer, and budget.",
    "Only rank candidate IDs supplied below. Never invent a product or SKU.",
    "Pricing guardrail: approved_msrp is the ONLY pricing information you may use. Catalog descriptions are never pricing authority.",
    "If the user specifies a budget, prefer candidates with approved MSRP within that budget. Do not infer missing prices.",
    "Return no more than 30 useful results. Give each a 0-100 relevance score and a short practical reason.",
    `User request: ${prompt || "(filters only)"}`,
    `Manufacturer filter: ${manufacturerId || "Any"}`,
    `Category filter: ${body?.category || "Any"}`,
    `Collection filter: ${body?.collection || "Any"}`,
    `Maximum approved MSRP: ${maxMsrp ?? "None"}`,
    `Priced only: ${pricedOnly ? "Yes" : "No"}`,
    `Candidates JSON: ${JSON.stringify(compactCandidates)}`,
  ].join("\n");

  const ai =
    await openAiStructured({
      prompt: aiPrompt,
      schemaName:
        "designer_patio_product_finder",
      schema: finderSchema,
      modelEnv:
        "OPENAI_FINDER_MODEL",
      defaultModel:
        "gpt-5.6-terra",
      maxOutputTokens: 8000,
    });

  const rankings =
    Array.isArray(
      ai.data?.rankings
    )
      ? ai.data.rankings
      : [];

  const byId =
    new Map(
      candidates.map(
        (candidate) => [
          candidate.item.id,
          candidate,
        ]
      )
    );

  const seen =
    new Set<string>();

  const results: any[] = [];

  for (const ranking of
    rankings) {
    const id =
      String(
        ranking
          ?.catalog_item_id ||
          ""
      ).trim();

    if (
      !id ||
      seen.has(id)
    ) {
      continue;
    }

    const candidate =
      byId.get(id);

    if (!candidate) continue;

    seen.add(id);

    const pct =
      Math.max(
        1,
        Math.min(
          99,
          Math.round(
            Number(
              ranking
                ?.relevance_score ??
                0
            ) || 0
          )
        )
      );

    results.push({
      catalogItem:
        candidate.item,
      catalog:
        candidate.catalog,
      manufacturer:
        candidate.manufacturer,
      prices:
        candidate.prices,
      score:
        Math.max(
          0,
          (pct - 45) / 2.2
        ),
      matchedTerms:
        Array.isArray(
          ranking
            ?.matched_terms
        )
          ? ranking.matched_terms
              .map(
                (term: unknown) =>
                  String(term)
                    .trim()
              )
              .filter(Boolean)
              .slice(0, 8)
          : [],
      aiMatchPct: pct,
      aiReason:
        cleanText(
          ranking?.reason,
          1000
        ),
    });
  }

  return {
    status: "success",
    model: ai.model,
    interpretation:
      cleanText(
        ai.data
          ?.interpretation,
        2000
      ),
    results,
  };
}

export async function POST(
  request: Request
) {
  try {
    const user =
      await authenticatedHubUser(
        request
      );

    if (!user) {
      return NextResponse.json(
        {
          error:
            "Hub authentication is required.",
        },
        {
          status: 401,
        }
      );
    }

    const body =
      await request
        .json()
        .catch(() => ({}));

    const action =
      String(
        body?.action || ""
      ).trim();

    if (
      action ===
      "ingest_catalog"
    ) {
      const catalogId =
        String(
          body?.catalog_id ||
            ""
        ).trim();

      if (!catalogId) {
        return NextResponse.json(
          {
            error:
              "catalog_id is required.",
          },
          {
            status: 400,
          }
        );
      }

      return NextResponse.json(
        await ingestCatalog(
          catalogId,
          user.id
        )
      );
    }

    if (
      action ===
      "ingest_price_list"
    ) {
      const priceListId =
        String(
          body?.price_list_id ||
            ""
        ).trim();

      if (!priceListId) {
        return NextResponse.json(
          {
            error:
              "price_list_id is required.",
          },
          {
            status: 400,
          }
        );
      }

      return NextResponse.json(
        await ingestPriceList(
          priceListId,
          user.id
        )
      );
    }

    if (action === "finder") {
      return NextResponse.json(
        await runFinder(body)
      );
    }

    return NextResponse.json(
      {
        error:
          "Unknown AI library action.",
      },
      {
        status: 400,
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "AI library server error",
        ...(error?.setupRequired
          ? {
              setup_required:
                error.setupRequired,
            }
          : {}),
      },
      {
        status:
          Number(
            error?.status
          ) || 500,
      }
    );
  }
}
