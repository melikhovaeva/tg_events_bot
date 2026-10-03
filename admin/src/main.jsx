import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarDays,
  Ban,
  Bold,
  Check,
  Copy,
  FileText,
  GripVertical,
  ImagePlus,
  Italic,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  MessagesSquare,
  Lock,
  LockOpen,
  Link,
  Pencil,
  Plus,
  Replace,
  QrCode,
  Send,
  Strikethrough,
  Trash2,
  Underline,
  Users,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "./components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import "./styles.css";

const statusNames = {
  awaiting_review: "Новая заявка",
  invited: "Ждёт ответа",
  pending: "Ждёт ответа",
  confirmed: "Подтвердил",
  declined: "Отказался",
  expired: "Не ответил за 24 часа",
  cancelled: "Отменил регистрацию",
};
const fmt = (value) =>
  new Date(value).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const count = (value) => Number(value || 0);
async function request(url, options) {
  const r = await fetch(url, options);
  if (r.status === 401) {
    window.location.assign("/login/form");
    throw new Error("Сессия закончилась. Войдите снова.");
  }
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error || "Не удалось сохранить изменения");
  }
  return r;
}

function SortableImage({ image, onRemove, onReplace }) {
  const s = useSortable({ id: image.id });
  return (
    <div
      ref={s.setNodeRef}
      style={{
        transform: CSS.Transform.toString(s.transform),
        transition: s.transition,
      }}
      className={`group relative aspect-square overflow-hidden rounded-md border bg-muted ${s.isDragging ? "z-10 opacity-50 ring-2 ring-ring" : ""}`}
    >
      <img src={image.url} className="h-full w-full object-cover" />
      <button
        type="button"
        className="absolute left-1 top-1 cursor-grab rounded bg-background/85 p-1 opacity-0 shadow-sm group-hover:opacity-100"
        {...s.attributes}
        {...s.listeners}
      >
        <GripVertical size={15} />
      </button>
      <div className="absolute inset-x-1 bottom-1 flex justify-end gap-1 opacity-0 group-hover:opacity-100">
        <label className="cursor-pointer rounded bg-background/90 p-1.5 shadow-sm">
          <Replace size={14} />
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => onReplace(image.id, e.target.files?.[0])}
          />
        </label>
        <button
          type="button"
          onClick={() => onRemove(image.id)}
          className="rounded bg-destructive p-1.5 text-white"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
function ImagePicker({ images, setImages }) {
  const ref = useRef(null);
  const [fileError, setFileError] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const add = (files) => {
    const selected = Array.from(files || []).filter((file) => file.type.startsWith("image/") || /\.(avif|gif|heic|heif|jpe?g|png|webp)$/i.test(file.name));
    if (!selected.length) { setFileError("Выберите файл изображения."); return; }
    setFileError("");
    setImages((current) => [...current, ...selected.slice(0, 9 - current.length).map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }))]);
  };
  const sort = ({ active, over }) =>
    over &&
    active.id !== over.id &&
    setImages((current) =>
      arrayMove(
        current,
        current.findIndex((i) => i.id === active.id),
        current.findIndex((i) => i.id === over.id),
      ),
    );
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={sort}
        >
          <SortableContext
            items={images.map((i) => i.id)}
            strategy={rectSortingStrategy}
          >
            {images.map((i) => (
              <SortableImage
                key={i.id}
                image={i}
                onRemove={(id) =>
                  setImages((c) => c.filter((i) => i.id !== id))
                }
                onReplace={(id, file) =>
                  file &&
                  setImages((c) =>
                    c.map((i) =>
                      i.id === id
                        ? { id, file, url: URL.createObjectURL(file) }
                        : i,
                    ),
                  )
                }
              />
            ))}
          </SortableContext>
        </DndContext>
        {images.length < 9 && (
          <button
            type="button"
            onClick={() => ref.current?.click()}
            className="flex aspect-square flex-col items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground hover:bg-accent"
          >
            <ImagePlus size={20} />
            Добавить
          </button>
        )}
      </div>
      <input
        ref={ref}
        className="sr-only"
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      <p className="text-xs font-normal text-muted-foreground">
        {images.length}/9 изображений. Перетаскивайте за ручку; при наведении
        доступны замена и удаление.
      </p>
      {fileError && <p className="text-xs text-destructive">{fileError}</p>}
    </div>
  );
}
function FilePicker({ files, setFiles }) {
  const ref = useRef(null);
  const add = (newFiles) => setFiles((current) => [...current, ...Array.from(newFiles || []).slice(0, 10 - current.length).map((file) => ({ id: crypto.randomUUID(), file, name: file.name }))]);
  return <div className="grid gap-2"><div className="grid gap-2">{files.map((file) => <div key={file.id} className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm"><div className="flex min-w-0 items-center gap-2"><FileText size={16} className="shrink-0 text-muted-foreground" />{file.url ? <a href={file.url} className="truncate hover:underline">{file.name}</a> : <span className="truncate">{file.name}</span>}</div><button type="button" onClick={() => setFiles((current) => current.filter((item) => item.id !== file.id))} className="rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive" aria-label={`Удалить ${file.name}`}><Trash2 size={15} /></button></div>)}</div>{files.length < 10 && <><Button type="button" variant="outline" className="w-fit" onClick={() => ref.current?.click()}><Plus size={15} />Прикрепить файл</Button><input ref={ref} type="file" multiple className="sr-only" onChange={(event) => { add(event.target.files); event.target.value = ""; }} /></>}<p className="text-xs font-normal text-muted-foreground">До 10 файлов, размер каждого — до 20 МБ.</p></div>;
}
function CreateDialog({ open, setOpen, create }) {
  const [images, setImages] = useState([]);
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await create(e.currentTarget, images);
      e.currentTarget.reset();
      setImages([]);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !saving && setOpen(nextOpen)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новое мероприятие</DialogTitle>
          <DialogDescription>
            Карточка и анонс будут готовы сразу после создания.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium">
            Название
            <Input name="title" required />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Дата и время
            <Input name="starts_at" type="datetime-local" required />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Место
            <Input name="venue" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Изображения карточки
            <ImagePicker images={images} setImages={setImages} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Текст анонса
            <Textarea
              name="description"
              placeholder="Абзацы, эмодзи и ссылки поддерживаются"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Ссылка на чат
            <Input name="chat_url" placeholder="https://t.me/..." />
          </label>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Отмена
            </Button>
            <Button disabled={saving}>{saving ? "Создаём…" : "Создать мероприятие"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function ConfirmDialog({ item, onClose }) {
  const [working, setWorking] = useState(false);
  if (!item) return null;
  const confirm = async () => { setWorking(true); try { await item.action(); onClose(); } finally { setWorking(false); } };
  return <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{item.title}</DialogTitle><DialogDescription>{item.description}</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Отмена</Button><Button className="bg-destructive text-white hover:bg-destructive/90" onClick={confirm} disabled={working}>{working ? "Удаляем…" : item.confirmLabel || "Удалить"}</Button></div></DialogContent></Dialog>;
}
function Stat({ label, value }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xl font-semibold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

const textPosts = [
  { key: "registration", field: "description", title: "Регистрация", hint: "Карточка, которую человек увидит перед заявкой.", placeholder: "Расскажите, что будет на событии" },
  { key: "invite", field: "invite_text", title: "Приглашение", hint: "Приходит, когда вы вручную приглашаете гостя.", placeholder: "Мы будем рады видеть вас на {event}!" },
  { key: "expired", field: "expired_text", title: "Нет ответа 24 часа", hint: "Отправляется, если приглашение осталось без ответа.", placeholder: "К сожалению, мы не дождались вашего ответа и освобождаем место." },
  { key: "confirmed", field: "confirmed_text", title: "Участие подтверждено", hint: "Гость видит его после нажатия «Подтверждаю участие».", placeholder: "Участие подтверждено — место закреплено за вами." },
  { key: "declined", field: "declined_text", title: "Пользователь отказался", hint: "Отправляется, если гость отказался или отменил участие.", placeholder: "Спасибо, что сообщили. Будем рады видеть вас на следующих мероприятиях!" },
  { key: "reminder", field: "reminder_text", title: "Напоминание за сутки", hint: "С просьбой ещё раз подтвердить, что гость придёт.", placeholder: "Напоминаем: «{event}» уже завтра. Ждём вас!" },
];

const plainText = (html = "") => html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");

function EventTexts({ event, messageImages = [], onEdit }) {
  return <div className="mt-7 grid max-w-3xl gap-3">
    {textPosts.map((post) => {
      const postImages = messageImages.filter((image) => image.message_key === post.key);
      const preview = plainText(event[post.field] || post.placeholder).trim();
      return <Card key={post.key}>
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">{post.title}</h2>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{preview}</p>
              {!!postImages.length && <div className="mt-3 flex -space-x-1.5">{postImages.slice(0, 5).map((image) => <img key={image.id} src={`/api/admin/message-images/${image.id}`} className="h-8 w-8 rounded-md border-2 border-background object-cover" />)}{postImages.length > 5 && <span className="flex h-8 w-8 items-center justify-center rounded-md border-2 border-background bg-muted text-xs">+{postImages.length - 5}</span>}</div>}
            </div>
            <Button variant="secondary" size="sm" onClick={() => onEdit(post.key)}><Pencil size={14} />Редактировать</Button>
          </div>
        </CardContent>
      </Card>;
    })}
  </div>;
}

function RichTextEditor({ value, onChange, placeholder }) {
  const ref = useRef(null);
  const range = useRef(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState("");
  useEffect(() => { if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value; }, [value]);
  const preserve = (event) => event.preventDefault();
  const command = (name, arg = null) => { ref.current?.focus(); document.execCommand(name, false, arg); onChange(ref.current?.innerHTML || ""); };
  const openLink = () => {
    const selection = window.getSelection();
    range.current = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    setLinkUrl(""); setLinkError(""); setLinkOpen(true);
  };
  const addLink = (event) => {
    event.preventDefault();
    try { const parsed = new URL(linkUrl); if (!/^https?:$/.test(parsed.protocol)) throw new Error(); }
    catch { setLinkError("Укажите ссылку, которая начинается с https:// или http://"); return; }
    ref.current?.focus();
    if (range.current) { const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range.current); }
    const selected = window.getSelection()?.toString();
    if (selected) command("createLink", linkUrl);
    else command("insertHTML", `<a href="${linkUrl}">${linkUrl}</a>`);
    setLinkOpen(false);
  };
  const tools = [["bold", Bold, "Жирный"], ["italic", Italic, "Курсив"], ["underline", Underline, "Подчёркнутый"], ["strikeThrough", Strikethrough, "Зачёркнутый"]];
  return <><div className="overflow-hidden rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring">
      <div className="flex items-center gap-1 border-b bg-muted/40 p-1.5">
        {tools.map(([name, Icon, label]) => <button key={name} type="button" title={label} aria-label={label} onMouseDown={preserve} onClick={() => command(name)} className="rounded p-1.5 hover:bg-background"><Icon size={16} /></button>)}
        <span className="mx-1 h-5 w-px bg-border" />
        <button type="button" title="Вставить ссылку" aria-label="Вставить ссылку" onMouseDown={preserve} onClick={openLink} className="rounded p-1.5 hover:bg-background"><Link size={16} /></button>
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" data-placeholder={placeholder} onInput={(event) => onChange(event.currentTarget.innerHTML)} className="min-h-44 px-3 py-2.5 text-sm leading-6 outline-none empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]" />
    </div>
    <Dialog open={linkOpen} onOpenChange={setLinkOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Добавить ссылку</DialogTitle><DialogDescription>Выделите текст в сообщении или вставьте ссылку отдельно.</DialogDescription></DialogHeader><form onSubmit={addLink} className="grid gap-4"><label className="grid gap-1.5 text-sm font-medium">Ссылка<Input autoFocus type="url" inputMode="url" value={linkUrl} onChange={(event) => { setLinkUrl(event.target.value); setLinkError(""); }} placeholder="https://example.com" /></label>{linkError && <p className="text-sm text-destructive">{linkError}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setLinkOpen(false)}>Отмена</Button><Button disabled={!linkUrl.trim()}>Добавить</Button></div></form></DialogContent></Dialog>
  </>;
}

function TextPostEditor({ event, post, messageImages, onSaved, onBack }) {
  const [text, setText] = useState(event[post.field] || "");
  const [images, setImages] = useState(() => messageImages.filter((image) => image.message_key === post.key).map((image) => ({ id: image.id, serverId: image.id, url: `/api/admin/message-images/${image.id}` })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true); setError("");
    try {
      const texts = Object.fromEntries(textPosts.map((item) => [item.field, item.key === post.key ? text : event[item.field] || ""]));
      await request(`/api/admin/events/${event.id}/texts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(texts) });
      const originalIds = messageImages.filter((image) => image.message_key === post.key).map((image) => image.id);
      const serverIds = images.filter((image) => image.serverId).map((image) => image.serverId);
      await Promise.all(originalIds.filter((id) => !serverIds.includes(id)).map((id) => request(`/api/admin/message-images/${id}`, { method: "DELETE" })));
      const newImages = images.filter((image) => image.file);
      let added = [];
      if (newImages.length) { const body = new FormData(); newImages.forEach((image) => body.append("images", image.file)); added = (await (await request(`/api/admin/events/${event.id}/message-images/${post.key}`, { method: "POST", body })).json()).images; }
      let addedIndex = 0;
      await request(`/api/admin/events/${event.id}/message-images/${post.key}/order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: images.map((image) => image.serverId || added[addedIndex++].id) }) });
      await onSaved(); onBack();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };
  return <>
    <button onClick={onBack} className="mb-5 text-sm text-muted-foreground hover:text-foreground">← Тексты события</button>
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl font-semibold tracking-tight">{post.title}</h1><p className="mt-2 text-muted-foreground">{post.hint}</p></div><span className="text-xs text-muted-foreground">Поддерживаются жирный, курсив, подчёркивание, зачёркивание и ссылки.</span></div>
    <Card className="mt-7 max-w-3xl"><CardContent className="grid gap-6 p-5 sm:p-6"><label className="grid gap-2 text-sm font-medium">Текст сообщения<RichTextEditor value={text} onChange={setText} placeholder={post.placeholder} /></label><div className="grid gap-2 text-sm font-medium">Изображения<ImagePicker images={images} setImages={setImages} /></div><p className="text-xs text-muted-foreground">Изображения отправятся отдельным альбомом сразу после сообщения.</p>{error && <p className="text-sm text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={onBack}>Отмена</Button><Button onClick={save} disabled={saving}>{saving ? "Сохраняем…" : "Сохранить"}</Button></div></CardContent></Card>
  </>;
}

const localDateTime = (value) => {
  const date = new Date(value); const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
function EventEditor({ event, eventImages, onSaved, onBack }) {
  const [title, setTitle] = useState(event.title);
  const [startsAt, setStartsAt] = useState(localDateTime(event.starts_at));
  const [venue, setVenue] = useState(event.venue || "");
  const [chatUrl, setChatUrl] = useState(event.chat_url || "");
  const [description, setDescription] = useState(event.description || "");
  const [images, setImages] = useState(() => eventImages.map((image) => ({ id: image.id, serverId: image.id, url: `/api/admin/event-images/${image.id}` })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setImages(eventImages.map((image) => ({ id: image.id, serverId: image.id, url: `/api/admin/event-images/${image.id}` }))); }, [eventImages]);
  const save = async () => {
    setSaving(true); setError("");
    try {
      await request(`/api/admin/events/${event.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, starts_at: startsAt, venue, chat_url: chatUrl, description }) });
      const originalIds = eventImages.map((image) => image.id);
      const serverIds = images.filter((image) => image.serverId).map((image) => image.serverId);
      await Promise.all(originalIds.filter((id) => !serverIds.includes(id)).map((id) => request(`/api/admin/event-images/${id}`, { method: "DELETE" })));
      const newImages = images.filter((image) => image.file);
      let added = [];
      if (newImages.length) { const body = new FormData(); newImages.forEach((image) => body.append("images", image.file)); added = (await (await request(`/api/admin/events/${event.id}/images`, { method: "POST", body })).json()).images; }
      let addedIndex = 0;
      await request(`/api/admin/events/${event.id}/images/order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: images.map((image) => image.serverId || added[addedIndex++].id) }) });
      await onSaved(); onBack();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };
  return <><button onClick={onBack} className="mb-5 text-sm text-muted-foreground hover:text-foreground">← {event.title}</button><div><h1 className="text-3xl font-semibold tracking-tight">Редактировать мероприятие</h1><p className="mt-2 text-muted-foreground">Изменения сразу попадут в карточку регистрации в боте.</p></div><Card className="mt-7 max-w-3xl"><CardContent className="grid gap-5 p-5 sm:p-6"><label className="grid gap-1.5 text-sm font-medium">Название<Input value={title} onChange={(e) => setTitle(e.target.value)} /></label><div className="grid gap-5 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">Дата и время<Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label><label className="grid gap-1.5 text-sm font-medium">Место<Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Адрес или площадка" /></label></div><label className="grid gap-1.5 text-sm font-medium">Ссылка на чат<Input type="url" value={chatUrl} onChange={(e) => setChatUrl(e.target.value)} placeholder="https://t.me/..." /></label><label className="grid gap-1.5 text-sm font-medium">Анонс в карточке регистрации<RichTextEditor value={description} onChange={setDescription} placeholder="Расскажите, что будет на событии" /></label><div className="grid gap-1.5 text-sm font-medium">Изображения карточки<ImagePicker images={images} setImages={setImages} /></div>{error && <p className="text-sm text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={onBack}>Отмена</Button><Button onClick={save} disabled={saving || !title.trim() || !startsAt}>{saving ? "Сохраняем…" : "Сохранить изменения"}</Button></div></CardContent></Card></>;
}

function Checkin({ event, onBack, onCheckedIn }) {
  const input = useRef(null);
  const [code, setCode] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setError(""); setResult(null);
    try {
      const response = await fetch("/api/admin/checkin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, event_id: event.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось отметить гостя");
      setResult(data); setCode(""); await onCheckedIn();
    } catch (e) { setError(e.message); }
    finally { window.setTimeout(() => input.current?.focus(), 0); }
  };
  useEffect(() => { input.current?.focus(); }, []);
  return <>
    <button onClick={onBack} className="mb-5 text-sm text-muted-foreground hover:text-foreground">← {event.title}</button>
    <div><h1 className="text-3xl font-semibold tracking-tight">Чек-ин</h1><p className="mt-2 text-muted-foreground">Сканируйте QR камерой или подключённым сканером. Код автоматически подставится в поле.</p></div>
    <Card className="mt-7 max-w-xl"><CardContent className="p-5 sm:p-6"><form onSubmit={submit} className="grid gap-4"><label className="grid gap-2 text-sm font-medium">Код гостя<Input ref={input} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Сканируйте QR или вставьте код" autoComplete="off" /></label><Button disabled={!code.trim()}><QrCode size={16} />Отметить приход</Button></form>{result && <div className="mt-5 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800"><b>{result.guest}</b> отмечен на мероприятии.</div>}{error && <div className="mt-5 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}</CardContent></Card>
  </>;
}

function PostEditor({ post, events, postImages, postFiles, onSaved, onBack }) {
  const [title, setTitle] = useState(post?.title || "");
  const [content, setContent] = useState(post?.content || "");
  const [audience, setAudience] = useState(post?.audience || "all");
  const [eventId, setEventId] = useState(post?.event_id ? String(post.event_id) : "");
  const [images, setImages] = useState(() => post ? postImages.filter((image) => image.post_id === post.id).map((image) => ({ id: image.id, serverId: image.id, url: `/api/admin/post-images/${image.id}` })) : []);
  const [files, setFiles] = useState(() => post ? postFiles.filter((file) => file.post_id === post.id).map((file) => ({ id: file.id, serverId: file.id, name: file.original_name, url: `/api/admin/post-files/${file.id}` })) : []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setTitle(post?.title || ""); setContent(post?.content || ""); setAudience(post?.audience || "all"); setEventId(post?.event_id ? String(post.event_id) : "");
    setImages(post ? postImages.filter((image) => image.post_id === post.id).map((image) => ({ id: image.id, serverId: image.id, url: `/api/admin/post-images/${image.id}` })) : []);
    setFiles(post ? postFiles.filter((file) => file.post_id === post.id).map((file) => ({ id: file.id, serverId: file.id, name: file.original_name, url: `/api/admin/post-files/${file.id}` })) : []);
  }, [post, postImages, postFiles]);
  const save = async () => {
    setSaving(true); setSaved(false); setError("");
    try {
      const response = await request(post ? `/api/admin/posts/${post.id}` : "/api/admin/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, content, audience, event_id: eventId }) });
      const data = await response.json();
      const postId = data.id;
      const originalImageIds = post ? postImages.filter((image) => image.post_id === post.id).map((image) => image.id) : [];
      const currentImageIds = images.filter((image) => image.serverId).map((image) => image.serverId);
      await Promise.all(originalImageIds.filter((id) => !currentImageIds.includes(id)).map((id) => request(`/api/admin/post-images/${id}`, { method: "DELETE" })));
      const newImages = images.filter((image) => image.file);
      let addedImages = [];
      if (newImages.length) { const body = new FormData(); newImages.forEach((image) => body.append("images", image.file)); addedImages = (await (await request(`/api/admin/posts/${postId}/images`, { method: "POST", body })).json()).images; }
      let imageIndex = 0;
      await request(`/api/admin/posts/${postId}/images/order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: images.map((image) => image.serverId || addedImages[imageIndex++].id) }) });
      const originalFileIds = post ? postFiles.filter((file) => file.post_id === post.id).map((file) => file.id) : [];
      const currentFileIds = files.filter((file) => file.serverId).map((file) => file.serverId);
      await Promise.all(originalFileIds.filter((id) => !currentFileIds.includes(id)).map((id) => request(`/api/admin/post-files/${id}`, { method: "DELETE" })));
      const newFiles = files.filter((file) => file.file);
      if (newFiles.length) { const body = new FormData(); newFiles.forEach((file) => body.append("files", file.file)); await request(`/api/admin/posts/${postId}/files`, { method: "POST", body }); }
      await onSaved(postId); setSaved(true);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };
  return <>
    <button onClick={onBack} className="mb-5 text-sm text-muted-foreground hover:text-foreground">← Все посты</button>
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl font-semibold tracking-tight">{post ? "Редактировать пост" : "Новый пост"}</h1><p className="mt-2 text-muted-foreground">Сохраните пост — позже его можно будет отредактировать и разослать повторно.</p></div><span className="text-xs text-muted-foreground">Пост пока остаётся черновиком.</span></div>
    <Card className="mt-7 max-w-3xl"><CardContent className="grid gap-6 p-5 sm:p-6"><label className="grid gap-2 text-sm font-medium">Название для команды<Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, напоминание после события" /></label><label className="grid gap-2 text-sm font-medium">Текст поста<RichTextEditor value={content} onChange={setContent} placeholder="Напишите сообщение для гостей" /></label><div className="grid gap-2 text-sm font-medium">Изображения<ImagePicker images={images} setImages={setImages} /></div><div className="grid gap-2 text-sm font-medium">Файлы<FilePicker files={files} setFiles={setFiles} /></div><div className="grid gap-2 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">Аудитория<select value={audience} onChange={(event) => setAudience(event.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm"><option value="all">Все, кто запустил бота</option><option value="event">Гости конкретного мероприятия</option><option value="manual">Выбрать гостей вручную</option></select></label>{audience === "event" && <label className="grid gap-1.5 text-sm font-medium">Мероприятие<select value={eventId} onChange={(event) => setEventId(event.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm"><option value="">Выберите мероприятие</option>{events.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}</div>{error && <p className="text-sm text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={onBack}>Назад</Button><Button onClick={save} disabled={saving || !title.trim() || (audience === "event" && !eventId)}>{saving ? "Сохраняем…" : saved ? "Сохранено" : "Сохранить черновик"}</Button></div></CardContent></Card>
  </>;
}

function Dialogs({ conversations, activeId, conversation, messages, onOpen, onSend }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setText(""); setError(""); }, [activeId]);
  const send = async () => {
    if (!text.trim()) return;
    setSending(true); setError("");
    try { await onSend(text); setText(""); }
    catch (e) { setError(e.message); }
    finally { setSending(false); }
  };
  return <>
    <h1 className="text-3xl font-semibold tracking-tight">Диалоги</h1>
    <p className="mt-2 text-muted-foreground">Сообщения, которые гости прислали этому боту. Здесь можно ответить от лица Perasperadastra.</p>
    <Card className="mt-7 overflow-hidden">
      <div className="grid min-h-[560px] md:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="border-b md:border-b-0 md:border-r">
          <div className="border-b px-4 py-3 text-sm font-medium">Все диалоги</div>
          <div className="max-h-[500px] overflow-y-auto p-2">
            {conversations.length ? conversations.map((item) => <button key={item.telegram_id} onClick={() => onOpen(item.telegram_id)} className={`w-full rounded-md px-3 py-3 text-left ${activeId === item.telegram_id ? "bg-accent" : "hover:bg-muted"}`}>
              <div className="flex items-center justify-between gap-2"><b className="truncate">{item.telegram_name ? `@${item.telegram_name}` : `Telegram ${item.telegram_id}`}</b>{count(item.unread_count) > 0 && <span className="rounded-full bg-foreground px-1.5 py-0.5 text-xs text-background">{item.unread_count}</span>}</div>
              <p className="mt-1 truncate text-sm text-muted-foreground">{plainText(item.last_message)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{fmt(item.last_message_at)}</p>
            </button>) : <p className="p-3 text-sm text-muted-foreground">Пока нет сообщений от гостей.</p>}
          </div>
        </aside>
        <section className="flex min-w-0 flex-col">
          {!conversation ? <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">Выберите диалог слева, чтобы прочитать сообщения и ответить гостю.</div> : <>
            <div className="border-b px-5 py-3"><b>{conversation.telegram_name ? `@${conversation.telegram_name}` : `Telegram ${conversation.telegram_id}`}</b><p className="mt-0.5 text-xs text-muted-foreground">Ответ будет отправлен в личный чат с ботом.</p></div>
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-muted/20 p-4 sm:p-5">
              {messages.map((message) => <div key={message.id} className={`max-w-[84%] rounded-lg px-3 py-2 text-sm leading-6 ${message.direction === "out" ? "self-end bg-foreground text-background" : "self-start border bg-background"}`}><p className="whitespace-pre-wrap">{plainText(message.text)}</p><p className={`mt-1 text-[11px] ${message.direction === "out" ? "text-background/60" : "text-muted-foreground"}`}>{fmt(message.created_at)}</p></div>)}
            </div>
            <div className="border-t p-3 sm:p-4"><div className="flex gap-2"><Textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Напишите ответ…" className="min-h-20 resize-none" /><Button className="self-end" onClick={send} disabled={sending || !text.trim()} title="Отправить" aria-label="Отправить">{sending ? "…" : <Send size={16} />}</Button></div>{error && <p className="mt-2 text-sm text-destructive">{error}</p>}</div>
          </>}
        </section>
      </div>
    </Card>
  </>;
}

function App() {
  const initialRoute = new URLSearchParams(window.location.search);
  const initialPage = initialRoute.get("page") || "events";
  const initialEvent = Number(initialRoute.get("event")) || null;
  const initialPost = initialRoute.get("text") || (initialPage === "textEditor" ? initialRoute.get("post") : null);
  const initialBroadcast = Number(initialRoute.get("postId")) || null;
  const initialDialog = initialRoute.get("dialog") || null;
  const [state, setState] = useState({
    events: [],
    people: [],
    guests: [],
    assets: [],
    posts: [],
    conversations: [],
  });
  const [page, setPage] = useState(initialPage);
  const [active, setActive] = useState(initialEvent);
  const [activePost, setActivePost] = useState(initialPost);
  const [activeBroadcast, setActiveBroadcast] = useState(initialBroadcast);
  const [activeDialog, setActiveDialog] = useState(initialDialog);
  const [dialog, setDialog] = useState(null);
  const [dialogMessages, setDialogMessages] = useState([]);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedApplicants, setSelectedApplicants] = useState([]);
  const [invitingIds, setInvitingIds] = useState([]);
  const [bulkNotice, setBulkNotice] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState("");
  const checkedStartEvent = useRef(false);
  const load = async (id) => {
    try {
      const r = await request(`/api/admin/state${id ? `?event=${id}` : ""}`);
      const data = await r.json();
      setState(data);
      setActive(data.selected || null);
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    load(initialEvent);
  }, []);
  useEffect(() => {
    if (page !== "detail" || !active) return undefined;
    const refresh = window.setInterval(() => load(active), 20_000);
    return () => window.clearInterval(refresh);
  }, [page, active]);
  useEffect(() => {
    if (checkedStartEvent.current || initialPage !== "events" || initialEvent || !state.events.length) return;
    checkedStartEvent.current = true;
    const activeEvents = state.events.filter((item) => Boolean(item.registration_open));
    if (activeEvents.length === 1) {
      setActive(activeEvents[0].id);
      setPage("detail");
    }
  }, [state.events]);
  useEffect(() => {
    const params = new URLSearchParams();
    const needsEvent = ["detail", "eventEditor", "texts", "textEditor", "checkin"].includes(page);
    if (page !== "events") params.set("page", page);
    if (needsEvent && active) params.set("event", active);
    if (page === "textEditor" && activePost) params.set("text", activePost);
    if (page === "postEditor" && activeBroadcast) params.set("postId", activeBroadcast);
    if (page === "dialogs" && activeDialog) params.set("dialog", activeDialog);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [page, active, activePost, activeBroadcast, activeDialog]);
  const loadDialog = async (telegramId) => {
    try {
      const response = await request(`/api/admin/dialogs/${encodeURIComponent(telegramId)}`);
      const data = await response.json();
      setActiveDialog(telegramId); setDialog(data.conversation); setDialogMessages(data.messages);
      const refreshed = await request(`/api/admin/state${active ? `?event=${active}` : ""}`);
      setState(await refreshed.json());
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { if (initialPage === "dialogs" && initialDialog) loadDialog(initialDialog); }, []);
  const event = state.events.find((e) => e.id === active);
  const create = async (form, images) => {
    const body = new FormData(form);
    images.forEach((i) => body.append("images", i.file));
    await request("/admin/events", { method: "POST", body });
    await load();
  };
  const invite = async (id) => {
    if (invitingIds.includes(id)) return;
    setInvitingIds((current) => [...current, id]);
    setState((current) => ({ ...current, people: current.people.map((person) => person.id === id ? { ...person, invitation_status: "pending", status: "invited" } : person) }));
    try {
      const response = await request(`/api/admin/events/${event.id}/invitations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicantIds: [id] }) });
      const result = await response.json();
      if (!result.sent.length) throw new Error(result.skipped[0]?.reason || "Не удалось отправить приглашение");
      await load(active);
    } catch (e) {
      setError(e.message);
      await load(active);
    } finally {
      setInvitingIds((current) => current.filter((item) => item !== id));
    }
  };
  const eligibleApplicants = state.people.filter((person) => person.telegram_id && !person.blocked && !["pending", "confirmed"].includes(person.invitation_status));
  useEffect(() => {
    const eligibleIds = new Set(eligibleApplicants.map((person) => person.id));
    setSelectedApplicants((current) => current.filter((id) => eligibleIds.has(id)));
  }, [state.people]);
  const toggleApplicant = (id) => setSelectedApplicants((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleAllEligible = () => {
    const ids = eligibleApplicants.map((person) => person.id);
    const everySelected = ids.length > 0 && ids.every((id) => selectedApplicants.includes(id));
    setSelectedApplicants(everySelected ? (current) => current.filter((id) => !ids.includes(id)) : (current) => [...new Set([...current, ...ids])]);
  };
  const bulkInvite = () => setConfirm({
    title: `Отправить приглашение ${selectedApplicants.length} гостям?`,
    description: 'Каждый получит текст приглашения этого мероприятия и 24 часа на ответ. Уже подтверждённые и ожидающие ответа гости будут пропущены.',
    confirmLabel: 'Отправить приглашения',
    action: async () => {
      const response = await request(`/api/admin/events/${event.id}/invitations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicantIds: selectedApplicants }) });
      const result = await response.json();
      setBulkNotice(`Приглашения отправлены: ${result.sent.length}${result.skipped.length ? `. Пропущено: ${result.skipped.length}` : ""}.`);
      setSelectedApplicants([]);
      await load(event.id);
    },
  });
  const setRegistration = async (open) => {
    await request(`/api/admin/events/${event.id}/registration`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ open }) });
    await load(event.id);
  };
  const removeApplicant = (person) => setConfirm({
    title: "Удалить регистрацию?",
    description: `${person.name} будет удалён из списка гостей этого мероприятия. Это действие нельзя отменить.`,
    confirmLabel: "Удалить регистрацию",
    action: async () => { await request(`/api/admin/applicants/${person.id}`, { method: "DELETE" }); await load(event.id); },
  });
  const toggleBlock = async (person) => {
    await request(`/api/admin/applicants/${person.id}/block`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blocked: !person.blocked }) });
    await load(event.id);
  };
  const removeEvent = () => setConfirm({
    title: "Удалить мероприятие?",
    description: `Будут удалены «${event.title}», все заявки, приглашения и материалы. Это действие нельзя отменить.`,
    confirmLabel: "Удалить мероприятие",
    action: async () => { await request(`/api/admin/events/${event.id}`, { method: "DELETE" }); await load(); setPage("events"); },
  });
  const copy = async () => {
    await navigator.clipboard.writeText(
      `https://t.me/${state.botUsername}?start=event_${event.id}`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const openEvent = (id) => {
    setActive(id);
    load(id);
    setPage("detail");
  };
  const nav = [
    { id: "events", label: "Мероприятия", icon: LayoutDashboard },
    { id: "guests", label: "Гости", icon: Users },
    { id: "posts", label: "Посты", icon: MessageSquare },
    { id: "dialogs", label: "Диалоги", icon: MessagesSquare },
  ];
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5">
          <b>Event Ops</b>
          <nav className="flex items-center gap-1">
            {nav.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => { setPage(item.id); if (item.id === "dialogs") load(active); }}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${page === item.id ? "bg-accent font-medium" : "hover:bg-accent"}`}
                >
                  <Icon size={16} />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <form action="/logout" method="post">
            <button title="Выйти из админки" aria-label="Выйти из админки" className="flex h-9 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <LogOut size={16} />
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-7xl min-w-0 p-6 lg:p-10">
          {error && (
            <p className="mb-5 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          {page === "events" && (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight">Мероприятия</h1>
                  <p className="mt-2 text-muted-foreground">Выберите событие, чтобы открыть гостей, тексты и материалы.</p>
                </div>
                <Button onClick={() => setOpen(true)}><Plus size={16} />Создать мероприятие</Button>
              </div>
              <div className="mt-7 grid gap-4 md:grid-cols-2">
                {state.events.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => openEvent(item.id)}
                    className="rounded-xl border bg-card p-5 text-left shadow-sm transition hover:border-foreground/30"
                  >
                    <p className="font-semibold">{item.title}</p>
                    <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                      <CalendarDays size={14} />
                      {fmt(item.starts_at)}
                    </p>
                    <div className="mt-5 grid grid-cols-3 gap-2">
                      <Stat label="заявок" value={count(item.registered)} />
                      <Stat label="приглашений" value={count(item.invited)} />
                      <Stat label="подтвердили" value={count(item.confirmed)} />
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
          {page === "detail" && event && (
            <>
              <button
                onClick={() => setPage("events")}
                className="mb-5 text-sm text-muted-foreground hover:text-foreground"
              >
                ← Все мероприятия
              </button>
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight">
                    {event.title}
                  </h1>
                  <p className="mt-2 text-muted-foreground">
                    {fmt(event.starts_at)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="h-9 w-9 p-0" title="Редактировать мероприятие" aria-label="Редактировать мероприятие" onClick={() => setPage("eventEditor")}>
                    <Pencil size={15} />
                  </Button>
                  <Button variant="outline" className="h-9 w-9 p-0" title="Чек-ин" aria-label="Чек-ин" onClick={() => setPage("checkin")}>
                    <QrCode size={15} />
                  </Button>
                  <Button variant="outline" className="h-9 w-9 p-0" title="Тексты события" aria-label="Тексты события" onClick={() => setPage("texts")}>
                    <FileText size={15} />
                  </Button>
                  <Button variant="outline" className="h-9 w-9 p-0" title={copied ? "Ссылка скопирована" : "Скопировать ссылку на регистрацию"} aria-label={copied ? "Ссылка скопирована" : "Скопировать ссылку на регистрацию"} onClick={copy}>
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                  </Button>
                  <Button variant="outline" className="h-9 w-9 p-0" title={event.registration_open ? "Закрыть регистрацию" : "Открыть регистрацию"} aria-label={event.registration_open ? "Закрыть регистрацию" : "Открыть регистрацию"} onClick={() => setRegistration(!event.registration_open)}>
                    {event.registration_open ? <Lock size={15} /> : <LockOpen size={15} />}
                  </Button>
                  <Button variant="outline" className="h-9 w-9 p-0 text-destructive hover:text-destructive" title="Удалить мероприятие" aria-label="Удалить мероприятие" onClick={removeEvent}>
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
              <div className="mt-7 grid gap-4 md:grid-cols-4">
                <Stat
                  label="зарегистрировалось"
                  value={count(event.registered)}
                />
                <Stat label="приглашений" value={count(event.invited)} />
                <Stat
                  label="подтвердило участие"
                  value={count(event.confirmed)}
                />
                <Stat label="пришли" value={count(event.checked_in)} />
              </div>
              {!event.registration_open && <p className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-sm">Регистрация закрыта: новые гости не смогут подать заявку по ссылке.</p>}
              <Card className="mt-6">
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Заявки</CardTitle><div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={toggleAllEligible} disabled={!eligibleApplicants.length}>{eligibleApplicants.length && eligibleApplicants.every((person) => selectedApplicants.includes(person.id)) ? "Снять выбор" : "Выбрать доступных"}</Button><Button size="sm" onClick={bulkInvite} disabled={!selectedApplicants.length}><Send size={14} />Пригласить выбранных{selectedApplicants.length ? ` (${selectedApplicants.length})` : ""}</Button></div></div>
                </CardHeader>
                {bulkNotice && <p className="mx-6 mb-1 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{bulkNotice}</p>}
                <CardContent className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="w-10 pb-3"><input className="h-4 w-4 accent-foreground" type="checkbox" aria-label="Выбрать всех доступных гостей" checked={eligibleApplicants.length > 0 && eligibleApplicants.every((person) => selectedApplicants.includes(person.id))} onChange={toggleAllEligible} disabled={!eligibleApplicants.length} /></th>
                        <th className="pb-3">Участник</th>
                        <th className="pb-3">Telegram</th>
                        <th className="pb-3">Статус</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {state.people.map((p) => (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="py-3"><input className="h-4 w-4 accent-foreground" type="checkbox" aria-label={`Выбрать ${p.name}`} checked={selectedApplicants.includes(p.id)} onChange={() => toggleApplicant(p.id)} disabled={!eligibleApplicants.some((person) => person.id === p.id)} /></td>
                          <td className="py-3">
                            <b>{p.name}</b>
                            <br />
                            <span className="text-muted-foreground">
                              {p.phone}
                            </span>
                          </td>
                          <td className="py-3">
                            {p.telegram_name ? `@${p.telegram_name}` : "—"}
                          </td>
                          <td className="py-3">
                            <span>{p.blocked ? "Доступ ограничен" : p.checked_in_at ? "Пришёл" : p.invitation_status === "confirmed" && p.reminder_sent_at && !p.final_confirmed_at ? "Ждём финального ответа" : p.invitation_status === "confirmed" && p.final_confirmed_at ? "Участие подтверждено" : p.invitation_status === "confirmed" ? "Первично подтвердил" : statusNames[p.invitation_status || p.status]}</span>
                            {!p.blocked && p.invitation_status === "pending" && p.previous_invitation_status && <small className="block text-muted-foreground">Ранее: {statusNames[p.previous_invitation_status]}</small>}
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex justify-end gap-1">
                            {p.telegram_id && !p.blocked &&
                              !["pending", "confirmed"].includes(
                                p.invitation_status,
                              ) && (
                                <Button size="sm" onClick={() => invite(p.id)} disabled={invitingIds.includes(p.id)}>
                                  <Send size={14} />
                                  {invitingIds.includes(p.id) ? "Отправляем…" : "Пригласить"}
                                </Button>
                              )}
                            {p.telegram_id && <Button variant="outline" size="sm" title={p.blocked ? "Вернуть доступ к боту" : "Ограничить доступ к боту"} aria-label={p.blocked ? "Вернуть доступ к боту" : "Ограничить доступ к боту"} onClick={() => toggleBlock(p)}><Ban size={14} /></Button>}
                            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" title="Удалить регистрацию" aria-label="Удалить регистрацию" onClick={() => removeApplicant(p)}><Trash2 size={14} /></Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
          {page === "texts" && event && (
            <>
              <button
                onClick={() => setPage("detail")}
                className="mb-5 text-sm text-muted-foreground hover:text-foreground"
              >
                ← {event.title}
              </button>
              <h1 className="text-3xl font-semibold tracking-tight">
                Тексты события
              </h1>
              <p className="mt-2 text-muted-foreground">
                Шесть сообщений для пути гостя — каждое с собственным текстом и изображениями.
              </p>
              <EventTexts event={event} messageImages={state.messageImages} onEdit={(key) => { setActivePost(key); setPage("textEditor"); }} />
            </>
          )}
          {page === "eventEditor" && event && <EventEditor event={event} eventImages={state.eventImages || []} onSaved={() => load(event.id)} onBack={() => setPage("detail")} />}
          {page === "textEditor" && event && activePost && (
            <TextPostEditor
              event={event}
              post={textPosts.find((post) => post.key === activePost)}
              messageImages={state.messageImages}
              onSaved={() => load(event.id)}
              onBack={() => setPage("texts")}
            />
          )}
          {page === "checkin" && event && <Checkin event={event} onBack={() => setPage("detail")} onCheckedIn={() => load(event.id)} />}
          {page === "guests" && (
            <>
              <h1 className="text-3xl font-semibold tracking-tight">Гости</h1>
              <p className="mt-2 text-muted-foreground">
                Единая база людей, которые уже были в ваших событиях или подали
                заявку.
              </p>
              <Card className="mt-7">
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="p-4">Гость</th>
                        <th className="p-4">Telegram</th>
                        <th className="p-4">Событий</th>
                        <th className="p-4">Последняя заявка</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.guests.map((g) => (
                        <tr
                          key={g.telegram_id || g.name}
                          className="border-b last:border-0"
                        >
                          <td className="p-4">
                            <b>{g.name}</b>
                            <br />
                            <span className="text-muted-foreground">
                              {g.phone}
                            </span>
                          </td>
                          <td className="p-4">
                            {g.telegram_name ? `@${g.telegram_name}` : "—"}
                          </td>
                          <td className="p-4">{g.events_count}</td>
                          <td className="p-4 text-muted-foreground">
                            {fmt(g.last_seen)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
          {page === "posts" && (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl font-semibold tracking-tight">Посты</h1><p className="mt-2 text-muted-foreground">Сохранённые черновики можно открыть, поправить и использовать повторно.</p></div><Button onClick={() => { setActiveBroadcast(null); setPage("postEditor"); }}><Plus size={16} />Новый пост</Button></div>
              <div className="mt-7 grid max-w-3xl gap-3">{state.posts.length ? state.posts.map((post) => { const images = (state.postImages || []).filter((image) => image.post_id === post.id); const files = (state.postFiles || []).filter((file) => file.post_id === post.id); return <Card key={post.id}><CardContent className="flex items-start justify-between gap-4 p-4 sm:p-5"><div className="min-w-0"><h2 className="font-semibold">{post.title}</h2><p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{plainText(post.content) || "Текст пока не добавлен"}</p>{!!images.length && <div className="mt-3 flex -space-x-1.5">{images.slice(0, 5).map((image) => <img key={image.id} src={`/api/admin/post-images/${image.id}`} className="h-8 w-8 rounded-md border-2 border-background object-cover" />)}{images.length > 5 && <span className="flex h-8 w-8 items-center justify-center rounded-md border-2 border-background bg-muted text-xs">+{images.length - 5}</span>}</div>}<p className="mt-3 text-xs text-muted-foreground">{post.audience === "all" ? "Все в боте" : post.audience === "event" ? `Гости: ${post.event_title || "мероприятие не выбрано"}` : "Гости выбраны вручную"}{files.length ? ` · файлов: ${files.length}` : ""} · изменён {fmt(post.updated_at)}</p></div><Button variant="secondary" size="sm" onClick={() => { setActiveBroadcast(post.id); setPage("postEditor"); }}><Pencil size={14} />Редактировать</Button></CardContent></Card>; }) : <Card><CardContent className="p-6 text-sm text-muted-foreground">Постов пока нет. Создайте первый, чтобы сохранить его для будущих рассылок.</CardContent></Card>}</div>
            </>
          )}
          {page === "dialogs" && <Dialogs conversations={state.conversations || []} activeId={activeDialog} conversation={dialog} messages={dialogMessages} onOpen={loadDialog} onSend={async (text) => { await request(`/api/admin/dialogs/${encodeURIComponent(activeDialog)}/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }); await loadDialog(activeDialog); }} />}
          {page === "postEditor" && <PostEditor post={activeBroadcast ? state.posts.find((post) => post.id === activeBroadcast) : null} events={state.events} postImages={state.postImages || []} postFiles={state.postFiles || []} onSaved={async (id) => { setActiveBroadcast(id); await load(active); }} onBack={() => setPage("posts")} />}
      </main>
      <CreateDialog open={open} setOpen={setOpen} create={create} />
      <ConfirmDialog item={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
