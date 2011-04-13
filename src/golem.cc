
#include <v8.h>
#include <node.h>

#include <unistd.h>
#include <sys/wait.h>
#include <sys/types.h>

#include <assert.h>
#include <string.h>
#include <stdlib.h>
#include <errno.h>
#include <pwd.h>
#include <grp.h>

using namespace v8;

static Persistent<String> onexit_symbol;
static Persistent<String> pid_symbol;

#include <node_object_wrap.h>
#include <ev.h>

class ChildProcess : node::ObjectWrap {

    public:
        static void Initialize(v8::Handle<v8::Object> target);
        static v8::Handle<v8::Value> New(const v8::Arguments& args);

    protected:
        static v8::Handle<v8::Value> Kill(const v8::Arguments& args);
        static v8::Handle<v8::Value> Fork(const v8::Arguments& args);

        ChildProcess() : ObjectWrap() {
            ev_init(&child_watcher, ChildProcess::child_callback);
            child_watcher.data = this;
            pid_ = -1;
        }
        ~ChildProcess() {
            Stop();
        }
        int Kill(int sig);

    private:
        ev_child child_watcher;
        pid_t    pid_;

        void OnExit(EV_P_ ev_child *watcher);
        void Stop(void);

        // Called by libev when a child changes status or exits.
        static void child_callback(EV_P_ ev_child *watcher, int revents) {
            ChildProcess *child = static_cast<ChildProcess*>(watcher->data);
            child->OnExit(watcher);
        }
};

Handle<Value> ChildProcess::New(const Arguments& args) {
    HandleScope scope;
    ChildProcess *p = new ChildProcess();
    p->Wrap(args.Holder());
    return args.This();
}

void ChildProcess::Initialize(Handle<Object> target) {
    HandleScope scope;

    Local<FunctionTemplate> t = FunctionTemplate::New(ChildProcess::New);
    t->InstanceTemplate()->SetInternalFieldCount(1);
    t->SetClassName(String::NewSymbol("ChildProcess"));

    pid_symbol    = NODE_PSYMBOL("pid");
    onexit_symbol = NODE_PSYMBOL("onexit");

    NODE_SET_PROTOTYPE_METHOD(t, "fork", ChildProcess::Fork);
    NODE_SET_PROTOTYPE_METHOD(t, "kill", ChildProcess::Kill);

    target->Set(String::NewSymbol("ChildProcess"), t->GetFunction());
}

Handle<Value> ChildProcess::Kill(const Arguments& args) {
    HandleScope scope;
    ChildProcess *child = ObjectWrap::Unwrap<ChildProcess>(args.Holder());

    if (child->pid_ < 1) {
        // nothing to do
        return False();
    }

    int sig = SIGTERM;

    if (args.Length() > 0) {
        if (args[0]->IsNumber()) {
            sig = args[0]->Int32Value();
        } else {
            return ThrowException(Exception::TypeError(String::New("Bad argument.")));
        }
    }

    if (child->Kill(sig) != 0) {
        return ThrowException(node::ErrnoException(errno, "Kill"));
    }

    return True();
}

int ChildProcess::Kill(int sig) {
    if (pid_ < 1) return -1;
    return kill(pid_, sig);
}

void ChildProcess::Stop() {
    if (ev_is_active(&child_watcher)) {
        ev_child_stop(EV_DEFAULT_UC_ &child_watcher);
        Unref();
    }
    Kill(SIGTERM);
    pid_ = -1;
}

Handle<Value> ChildProcess::Fork(const Arguments& args) {
    HandleScope scope;

    ChildProcess *child = ObjectWrap::Unwrap<ChildProcess>(args.Holder());

    assert(! ev_is_active(&child->child_watcher));

    pid_t pid = child->pid_ = fork();

    if (pid < 0) {
        return ThrowException(Exception::Error(String::New("couldn't fork process.")));
    } else if (pid > 0) {
        // - Parent -
        ev_child_set(&child->child_watcher, pid, 0);
        ev_child_start(EV_DEFAULT_UC_ &child->child_watcher);
        child->handle_->Set(pid_symbol, Integer::New(pid));
        child->Ref();
    } else {
        // - Child -
        ev_default_fork();

        if (args[0]->IsTrue()) {
            // Drop all watchers and
            // restart the event loop.
            ev_default_destroy();
            ev_default_loop();
        }
    }
    return scope.Close(Number::New(pid));
}

void ChildProcess::OnExit(EV_P_ ev_child *watcher) {
    HandleScope scope;

    int status = watcher->rstatus;

    pid_ = -1;
    Stop();

    handle_->Set(pid_symbol, Null());

    Local<Value> onexit_v = handle_->Get(onexit_symbol);
    assert(onexit_v->IsFunction());
    Local<Function> onexit = Local<Function>::Cast(onexit_v);

    TryCatch try_catch;

    Local<Value> argv[2];

    if (WIFEXITED(status)) {
        argv[0] = Integer::New(WEXITSTATUS(status));
    } else {
        argv[0] = Local<Value>::New(Null());
    }

    if (WIFSIGNALED(status)) {
        argv[1] = String::NewSymbol(node::signo_string(WTERMSIG(status)));
    } else {
        argv[1] = Local<Value>::New(Null());
    }

    onexit->Call(handle_, 2, argv);

    if (try_catch.HasCaught()) {
        node::FatalException(try_catch);
    }
}

static Handle<Value> execvp(const Arguments& args) {
    HandleScope scope;

    String::Utf8Value file(args[0]->ToString());
    Local<Array> argv_handle = Local<Array>::Cast(args[1]);
    int argc = argv_handle->Length();
    int argv_length = argc + 1;
    char **argv = new char*[argv_length];

    argv[argv_length - 1] = NULL;

    for (int i = 0; i < argc; i ++) {
        String::Utf8Value arg(argv_handle->Get(Integer::New(i))->ToString());
        argv[i] = strdup(*arg);
    }

    execvp(*file, argv);

    return scope.Close(Number::New(-1));
}

static Handle<Value> GetEuid(const Arguments& args) {
    HandleScope scope;
    return scope.Close(Number::New(geteuid()));
}

static Handle<Value> GetEgid(const Arguments& args) {
    HandleScope scope;
    return scope.Close(Number::New(getegid()));
}

static Handle<Value> GetPid(const Arguments& args) {
    HandleScope scope;
    return scope.Close(Number::New(getpid()));
}

static Handle<Value> GetPPid(const Arguments& args) {
    HandleScope scope;
    return scope.Close(Number::New(getppid()));
}

static Handle<Value> SetSid(const Arguments& args) {
    HandleScope scope;
    return scope.Close(Number::New(setsid()));
}

static Handle<Value> SetResUid(const Arguments& args) {
    HandleScope scope;

    int uid;

    static int SAVED_UID = -1;

    if (args[0]->IsNumber()) {
        uid = args[0]->Int32Value();
    } else {
        return False();
    }

    if (geteuid() == 0) { // root
        if (setresuid(uid, uid, uid) < 0) { return False(); }
        SAVED_UID = uid;
    } else {
        if (setresuid((getuid() == uid)  ? -1 : uid,
                      (geteuid() == uid) ? -1 : uid,
                      (SAVED_UID == uid) ? -1 : uid) < 0) { return False(); }
        SAVED_UID = uid;
    }
    return scope.Close(args[0]);
}

static Handle<Value> SetResGid(const Arguments& args) {
    HandleScope scope;

    int gid;

    static int SAVED_GID = -1;

    if (args[0]->IsNumber()) {
        gid = args[0]->Int32Value();
    } else {
        return False();
    }

    if (getegid() == 0) { // root
        if (setresgid(gid, gid, gid) < 0) { return False(); }
        SAVED_GID = gid;
    } else {
        if (setresgid((getgid() == gid)  ? -1 : gid,
                      (getegid() == gid) ? -1 : gid,
                      (SAVED_GID == gid) ? -1 : gid) < 0) { return False(); }
        SAVED_GID = gid;
    }
    return scope.Close(args[0]);
}

static Handle<Value> GetPwnam(const Arguments& args) {
    HandleScope scope;
    String::Utf8Value pwnam(args[0]->ToString());
    struct passwd *pwd;
    Local<Object> obj = Object::New();

    if (pwd = getpwnam(*pwnam)) {
        obj->Set(String::NewSymbol("name"),   String::New(pwd->pw_name));
        obj->Set(String::NewSymbol("passwd"), String::New(pwd->pw_passwd));
        obj->Set(String::NewSymbol("uid"),    Number::New(pwd->pw_uid));
        obj->Set(String::NewSymbol("gid"),    Number::New(pwd->pw_gid));
        obj->Set(String::NewSymbol("gecos"),  String::New(pwd->pw_gecos));
        obj->Set(String::NewSymbol("dir"),    String::New(pwd->pw_dir));
        obj->Set(String::NewSymbol("shell"),  String::New(pwd->pw_shell));
        return scope.Close(obj);
    } else {
        // Error
        return Null();
    }
}

static Handle<Value> GetGrnam(const Arguments& args) {
    HandleScope scope;
    String::Utf8Value grnam(args[0]->ToString());
    struct group *grp;
    Local<Object> obj = Object::New();
    Local<Array> members = Array::New();

    if (grp = getgrnam(*grnam)) {
        obj->Set(String::NewSymbol("name"),   String::New(grp->gr_name));
        obj->Set(String::NewSymbol("passwd"), String::New(grp->gr_passwd));
        obj->Set(String::NewSymbol("gid"),    Number::New(grp->gr_gid));

        for (int i = 0; i < sizeof(grp->gr_mem); i ++) {
            members->Set(Number::New(i), String::New(grp->gr_mem[i]));
        }
        obj->Set(String::NewSymbol("mem"), members);

        scope.Close(members);
        return scope.Close(obj);
    } else {
        // Error
        return Null();
    }
}

static Handle<Value> CloseStdio(const Arguments& args) {
    HandleScope scope;
    String::Utf8Value file(args[0]->ToString());

    freopen("/dev/null", "w",  stdin);
    freopen(*file,       "a+", stdout);
    freopen(*file,       "a+", stderr);
    return scope.Close(Number::New(0));
}

static Handle<Value> Access(const Arguments& args) {
    HandleScope scope;
    String::Utf8Value path(args[0]->ToString());
    int result = access(*path, args[1]->Int32Value());
    return scope.Close(Number::New(result));
}

extern "C" void init (Handle<Object> target) {
    HandleScope scope;

    NODE_SET_METHOD(target, "getpid",     GetPid);
    NODE_SET_METHOD(target, "getppid",    GetPPid);
    NODE_SET_METHOD(target, "geteuid",    GetEuid);
    NODE_SET_METHOD(target, "getegid",    GetEgid);
    NODE_SET_METHOD(target, "setsid",     SetSid);
    NODE_SET_METHOD(target, "access",     Access);
    NODE_SET_METHOD(target, "setresuid",  SetResUid);
    NODE_SET_METHOD(target, "setresgid",  SetResGid);
    NODE_SET_METHOD(target, "getpwnam",   GetPwnam);
    NODE_SET_METHOD(target, "getgrnam",   GetGrnam);
    NODE_SET_METHOD(target, "closeStdio", CloseStdio);

    ChildProcess::Initialize(target);
}

