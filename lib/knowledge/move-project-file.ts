import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export async function moveProjectFile(input: {
  supabase: SupabaseClient;
  fileId: string;
  sourceProjectId: string;
  targetProjectId: string;
}) {
  const { supabase, fileId, sourceProjectId, targetProjectId } = input;
  if (sourceProjectId === targetProjectId) throw new Error("SAME_PROJECT");
  const { data: file, error } = await supabase.from("project_files")
    .select("id,file_name,storage_path,file_type,mime_type,size,checksum,knowledge_documents(id,user_description,agent_summary)")
    .eq("id", fileId).eq("project_id", sourceProjectId).maybeSingle();
  if (error || !file) throw new Error("FILE_NOT_FOUND");
  const oldDocument = Array.isArray(file.knowledge_documents) ? file.knowledge_documents[0] : file.knowledge_documents;

  if (file.checksum) {
    const { data: duplicate } = await supabase.from("project_files")
      .select("id,file_name,knowledge_documents(id,status,user_description,agent_summary)")
      .eq("project_id", targetProjectId).eq("checksum", file.checksum).is("superseded_at", null).limit(1).maybeSingle();
    if (duplicate) {
      const duplicateDocument = Array.isArray(duplicate.knowledge_documents) ? duplicate.knowledge_documents[0] : duplicate.knowledge_documents;
      if (duplicateDocument && oldDocument) await supabase.rpc("update_knowledge_document_descriptions", {
        p_document_id: duplicateDocument.id,
        p_user_description: duplicateDocument.user_description || oldDocument.user_description || "",
        p_agent_summary: duplicateDocument.agent_summary || oldDocument.agent_summary || "",
      });
      const { error: completeError } = await supabase.rpc("complete_project_file_move", {
        p_source_project_id: sourceProjectId, p_source_file_id: fileId,
        p_target_project_id: targetProjectId, p_target_file_id: duplicate.id,
      });
      if (completeError) throw new Error("SOURCE_METADATA_REMOVE_FAILED");
      await supabase.storage.from("project-files").remove([file.storage_path]);
      return { file: duplicate, knowledge: duplicateDocument, reusedExisting: true };
    }
  }
  const { data: blob, error: downloadError } = await supabase.storage.from("project-files").download(file.storage_path);
  if (downloadError || !blob) throw new Error("DOWNLOAD_FAILED");
  const newId = crypto.randomUUID();
  const newPath = `${targetProjectId}/${newId}/source.${file.file_type}`;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { error: uploadError } = await supabase.storage.from("project-files").upload(newPath, bytes, { contentType: file.mime_type, cacheControl: "3600", upsert: false });
  if (uploadError) throw new Error("UPLOAD_FAILED");
  const { data: registered, error: registerError } = await supabase.rpc("register_project_file_v2", {
    p_id: newId, p_project_id: targetProjectId, p_file_name: file.file_name, p_storage_path: newPath,
    p_file_type: file.file_type, p_mime_type: file.mime_type, p_size: file.size, p_checksum: file.checksum, p_replaces_file_id: null,
  });
  if (registerError || !registered) { await supabase.storage.from("project-files").remove([newPath]); throw new Error(registerError?.message?.includes("Duplicate") ? "DUPLICATE" : "REGISTER_FAILED"); }
  const { data: nextDocument } = await supabase.from("knowledge_documents").select("id,status").eq("project_file_id", newId).maybeSingle();
  if (nextDocument && oldDocument) await supabase.rpc("update_knowledge_document_descriptions", {
    p_document_id: nextDocument.id, p_user_description: oldDocument.user_description || "", p_agent_summary: oldDocument.agent_summary || "",
  });
  const { error: removeMetadataError } = await supabase.rpc("complete_project_file_move", {
    p_source_project_id: sourceProjectId, p_source_file_id: fileId,
    p_target_project_id: targetProjectId, p_target_file_id: newId,
  });
  if (removeMetadataError) {
    await supabase.storage.from("project-files").remove([newPath]);
    await supabase.rpc("remove_project_file", { p_project_id: targetProjectId, p_file_id: newId });
    throw new Error("SOURCE_METADATA_REMOVE_FAILED");
  }
  await supabase.storage.from("project-files").remove([file.storage_path]);
  return { file: registered, knowledge: nextDocument };
}
