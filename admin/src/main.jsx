import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarDays,
  Bold,
  Check,
  Copy,
  FileText,
  GripVertical,
  ImagePlus,
  Italic,
  LayoutDashboard,
  MessageSquare,
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
  expired: "Срок истёк",
};
const fmt = (value) =>
  new Date(value).toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const count = (value) => Number(value || 0);
async function request(url, options) {
  const r = await fetch(url, options);
  if (!r.ok) throw new Error("Не удалось сохранить изменения");
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const add = (files) =>
    setImages((current) => [
      ...current,
      ...Array.from(files || [])
        .filter((f) => f.type.startsWith("image/"))
        .slice(0, 9 - current.length)
        .map((file) => ({
          id: crypto.randomUUID(),
          file,
          url: URL.createObjectURL(file),
        })),
    ]);
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
    </div>
  );
}
function CreateDialog({ open, setOpen, create }) {
  const [images, setImages] = useState([]);
  const submit = async (e) => {
    e.preventDefault();
    await create(e.currentTarget, images);
    e.currentTarget.reset();
    setImages([]);
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
            >
              Отмена
            </Button>
            <Button>Создать мероприятие</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
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

function App() {
  const [state, setState] = useState({
    events: [],
    people: [],
    guests: [],
    assets: [],
  });
  const [page, setPage] = useState("events");
  const [active, setActive] = useState(null);
  const [activePost, setActivePost] = useState(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
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
    load();
  }, []);
  const event = state.events.find((e) => e.id === active);
  const create = async (form, images) => {
    const body = new FormData(form);
    images.forEach((i) => body.append("images", i.file));
    await request("/admin/events", { method: "POST", body });
    await load();
  };
  const invite = async (id) => {
    await request(`/admin/invite/${id}`, { method: "POST" });
    await load(active);
  };
  const setRegistration = async (open) => {
    await request(`/api/admin/events/${event.id}/registration`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ open }) });
    await load(event.id);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(
      `https://t.me/${state.botUsername}?start=event_${event.id}`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const openEvent = (id) => {
    load(id);
    setPage("detail");
  };
  const nav = [
    { id: "events", label: "Мероприятия", icon: LayoutDashboard },
    { id: "guests", label: "Гости", icon: Users },
    { id: "posts", label: "Посты", icon: MessageSquare },
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
                  onClick={() => setPage(item.id)}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${page === item.id ? "bg-accent font-medium" : "hover:bg-accent"}`}
                >
                  <Icon size={16} />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} />
            Создать мероприятие
          </Button>
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
              <h1 className="text-3xl font-semibold tracking-tight">
                Мероприятия
              </h1>
              <p className="mt-2 text-muted-foreground">
                Выберите событие, чтобы открыть гостей, тексты и материалы.
              </p>
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
                  <Button variant="outline" onClick={() => setPage("checkin")}>
                    <QrCode size={15} />
                    Чек-ин
                  </Button>
                  <Button variant="outline" onClick={() => setPage("texts")}>
                    <FileText size={15} />
                    Тексты
                  </Button>
                  <Button variant="outline" onClick={copy}>
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                    {copied ? "Скопировано" : "Скопировать ссылку"}
                  </Button>
                  <Button variant="outline" onClick={() => setRegistration(!event.registration_open)}>
                    {event.registration_open ? <Lock size={15} /> : <LockOpen size={15} />}
                    {event.registration_open ? "Закрыть регистрацию" : "Открыть регистрацию"}
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
                  <CardTitle>Заявки</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-3">Участник</th>
                        <th className="pb-3">Telegram</th>
                        <th className="pb-3">Статус</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {state.people.map((p) => (
                        <tr key={p.id} className="border-b last:border-0">
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
                            {p.checked_in_at ? "Пришёл" : statusNames[p.invitation_status || p.status]}
                          </td>
                          <td className="py-3 text-right">
                            {p.telegram_id &&
                              !["pending", "confirmed"].includes(
                                p.invitation_status,
                              ) && (
                                <Button size="sm" onClick={() => invite(p.id)}>
                                  <Send size={14} />
                                  Пригласить
                                </Button>
                              )}
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
              <h1 className="text-3xl font-semibold tracking-tight">Посты</h1>
              <p className="mt-2 text-muted-foreground">
                Подготовьте сообщение и выберите, кому оно предназначено.
              </p>
              <Card className="mt-7 max-w-2xl">
                <CardHeader>
                  <CardTitle>Новый пост</CardTitle>
                  <CardDescription>
                    Перед массовой отправкой система покажет число получателей.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <label className="grid gap-1.5 text-sm font-medium">
                    Аудитория
                    <select className="h-9 rounded-md border bg-background px-3 text-sm">
                      <option>Все, кто запустил бота</option>
                      {state.events.map((e) => (
                        <option key={e.id}>
                          Зарегистрированные: {e.title}
                        </option>
                      ))}
                      <option>Выбрать гостей вручную</option>
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium">
                    Текст поста
                    <Textarea placeholder="Напишите сообщение для гостей" />
                  </label>
                  <Button disabled>
                    <Send size={15} />
                    Подготовить отправку
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Массовая отправка будет отдельным подтверждаемым шагом.
                  </p>
                </CardContent>
              </Card>
            </>
          )}
      </main>
      <CreateDialog open={open} setOpen={setOpen} create={create} />
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
