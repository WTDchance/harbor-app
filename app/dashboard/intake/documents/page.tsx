"use client";
// app/dashboard/intake/documents/page.tsx
// Harbor â Practice Document Manager
// Lets practices upload, create, and manage consent forms & documents for patient intake

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

const supabase = createClient();

type IntakeDocument = {
  id: string;
  name: string;
  requires_signature: boolean;
  content_url: string | null;
  description: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function apiFetch(url: string, options?: RequestInit) {
  const token = await getAuthToken();
  return fetch(url, {
    ...options,
    headers: {
      ...(options?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

async function apiJson(url: string, options?: RequestInit) {
  const token = await getAuthToken();
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  });
}

export default function DocumentManagerPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [documents, setDocuments] = useState<IntakeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formRequiresSignature, setFormRequiresSignature] = useState(true);
  const [formContentUrl, setFormContentUrl] = useState("");

  useEffect(() => { loadDocuments(); }, []);

  async function loadDocuments() {
    setLoading(true);
    try {
      const res = await apiJson("/api/intake/documents");
      if (res.status === 401) { router.push("/login"); return; }
      const data = await res.json();
      setDocuments((data.documents ?? []).filter((d: IntakeDocument) => d.active));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setFormName("");
    setFormDescription("");
    setFormRequiresSignature(true);
    setFormContentUrl("");
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(doc: IntakeDocument) {
    setFormName(doc.name);
    setFormDescription(doc.description || "");
    setFormRequiresSignature(doc.requires_signature);
    setFormContentUrl(doc.content_url || "");
    setEditingId(doc.id);
    setShowForm(true);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiFetch("/api/intake/documents/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.url) {
        setFormContentUrl(data.url);
      } else {
        alert(data.error || "Upload failed");
      }
    } catch {
      alert("Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSave() {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await apiJson("/api/intake/documents", {
          method: "PATCH",
          body: JSON.stringify({
            id: editingId,
            name: formName.trim(),
            description: formDescription.trim() || null,
            requires_signature: formRequiresSignature,
            content_url: formContentUrl.trim() || null,
          }),
        });
      } else {
        await apiJson("/api/intake/documents", {
          method: "POST",
          body: JSON.stringify({
            name: formName.trim(),
            description: formDescription.trim() || null,
            requires_signature: formRequiresSignature,
            content_url: formContentUrl.trim() || null,
          }),
        });
      }
      resetForm();
      await loadDocuments();
    } catch {
      alert("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this document from patient intake forms?")) return;
    await apiJson(`/api/intake/documents?id=${id}`, { method: "DELETE" });
    await loadDocuments();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/dashboard/intake")} className="text-sm text-gray-500 hover:text-teal-600 transition-colors">
              â Intake
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Intake Documents</h1>
              <p className="text-sm text-gray-500 mt-0.5">Manage consent forms and documents patients sign during intake</p>
            </div>
          </div>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition"
            >
              + Add Document
            </button>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-5">
        {/* Add/Edit Form */}
        {showForm && (
          <div className="bg-white rounded-xl border border-teal-200 shadow-sm p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-4">{editingId ? "Edit Document" : "Add New Document"}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Document Name *</label>
                <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
                  placeholder="e.g., Informed Consent for Treatment"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea value={formDescription} onChange={e => setFormDescription(e.target.value)}
                  placeholder="Brief description shown to patients..."
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400 resize-none" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Document File (PDF)</label>
                {formContentUrl ? (
                  <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-200">
                    <span className="text-green-600 text-lg">ð</span>
                    <span className="text-sm text-green-800 flex-1 truncate">{formContentUrl.split("/").pop()}</span>
                    <a href={formContentUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-teal-600 hover:text-teal-700">View</a>
                    <button onClick={() => setFormContentUrl("")} className="text-xs text-red-500 hover:text-red-600">Remove</button>
                  </div>
                ) : (
                  <div>
                    <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg"
                      onChange={handleFileUpload}
                      className="hidden" />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-teal-400 hover:text-teal-600 transition w-full justify-center"
                    >
                      {uploading ? (
                        <>
                          <div className="w-4 h-4 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>ð Upload PDF (optional)</>
                      )}
                    </button>
                    <p className="text-xs text-gray-400 mt-1">Max 10MB. Patients will be able to view this document before signing.</p>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                <input type="checkbox" id="requiresSig" checked={formRequiresSignature}
                  onChange={e => setFormRequiresSignature(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500" />
                <label htmlFor="requiresSig" className="text-sm text-gray-700">
                  Requires patient signature (e-sign)
                </label>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button onClick={handleSave} disabled={saving || !formName.trim()}
                  className="px-5 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:bg-gray-200 disabled:text-gray-400 transition">
                  {saving ? "Saving..." : editingId ? "Update Document" : "Add Document"}
                </button>
                <button onClick={resetForm} className="px-4 py-2.5 text-gray-500 text-sm hover:text-gray-700">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Document List */}
        {documents.length === 0 && !showForm ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
            <div className="text-4xl mb-3">ð</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No intake documents yet</h3>
            <p className="text-gray-500 text-sm mb-4">
              Add consent forms, privacy notices, and other documents that patients will sign during their intake.
            </p>
            <button onClick={() => setShowForm(true)}
              className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition">
              + Add Your First Document
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {documents.map((doc, i) => (
              <div key={doc.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-start gap-4">
                <div className="text-gray-400 text-lg mt-0.5">{i + 1}.</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-900">{doc.name}</h3>
                    {doc.requires_signature && (
                      <span className="text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full font-medium">E-sign</span>
                    )}
                  </div>
                  {doc.description && <p className="text-xs text-gray-500 mt-1">{doc.description}</p>}
                  {doc.content_url && (
                    <a href={doc.content_url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-teal-600 hover:text-teal-700 mt-1 inline-block">
                      ð View document
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => startEdit(doc)}
                    className="px-3 py-1.5 text-xs text-gray-500 hover:text-teal-600 border border-gray-200 rounded-lg hover:border-teal-300 transition">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(doc.id)}
                    className="px-3 py-1.5 text-xs text-red-400 hover:text-red-600 border border-gray-200 rounded-lg hover:border-red-300 transition">
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Info box */}
        <div className="bg-teal-50 rounded-xl p-4 border border-teal-100">
          <p className="text-sm text-teal-800 font-medium mb-1">How it works</p>
          <p className="text-xs text-teal-700">
            Documents you add here will appear in the consent section of your patient intake forms. Patients will be asked to read, acknowledge, and (if required) e-sign each document. You can upload a PDF for patients to view, or just add the document name and description. All signatures are captured with a drawn signature pad and stored securely.
          </p>
        </div>
      </div>
    </div>
  );
}
